import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
})

const toNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response({ error: 'Método no permitido.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') || ''
  const client = createClient(url, serviceKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await client.auth.getUser()
  if (!user) return response({ error: 'Sesión no válida.' }, 401)

  const { data: profile } = await client
    .from('user_profiles')
    .select('id,is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || profile.is_active === false) return response({ error: 'Tu acceso no está habilitado.' }, 403)

  // Supabase permite pegar valores multilínea; elimina espacios o saltos
  // accidentales para que Google reciba exactamente la clave creada.
  const geminiKey = Deno.env.get('GEMINI_API_KEY')?.trim()
  // La aplicación conserva su OCR local mientras el administrador todavía no
  // haya configurado la llave. Así ningún conductor queda bloqueado.
  if (!geminiKey) return response({ available: false, code: 'NOT_CONFIGURED' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return response({ error: 'Solicitud inválida.' }, 400) }
  const imageBase64 = String(body.imageBase64 || '').replace(/^data:[^,]+,/, '')
  const mimeType = String(body.mimeType || 'image/jpeg').toLowerCase()
  const minimumKm = Math.max(0, toNumber(body.minimumKm) || 0)
  const stage = body.stage === 'arrival' ? 'llegada' : 'salida'

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    return response({ error: 'Solo se permiten fotos JPG, PNG o WEBP.' }, 400)
  }
  // El límite deja margen para la solicitud de Gemini y evita que un archivo
  // excesivo consuma la cuota o vuelva lenta la conexión del conductor.
  if (!imageBase64 || imageBase64.length > 15 * 1024 * 1024) {
    return response({ error: 'La foto es demasiado grande. Toma otra foto más cerca del tablero.' }, 413)
  }

  const prompt = [
    'Analiza esta única foto para un control vehicular.',
    'Primero decide si muestra realmente un tablero, panel de instrumentos o una toma cercana de la pantalla del odómetro de un vehículo.',
    'Una foto parcial es válida: no es necesario que aparezca el tablero completo si se observa una pantalla integrada al vehículo y una lectura acumulada identificable como ODO, odómetro o kilometraje total.',
    'No confundas la velocidad, la hora, el número de marcha, la placa, una fecha, un recibo o cualquier texto con el kilometraje.',
    'Acepta tableros de motos, autos, camionetas y camiones, tanto digitales como mecánicos/analógicos, incluso si tienen reflejos leves o diseño antiguo.',
    'isOdometer debe ser verdadero cuando la imagen sí pertenece al tablero o a la pantalla de instrumentos del vehículo, aunque la lectura esté borrosa; readable indica por separado si los dígitos pueden leerse.',
    'Si la foto no es un tablero o si los dígitos del odómetro no se distinguen con seguridad, indica que no es legible.',
    `Es una lectura de ${stage}. El valor histórico de referencia es ${minimumKm} km; úsalo solamente como contexto y nunca para decidir si la foto es o no un tablero.`,
    'Devuelve únicamente un objeto JSON con estas cinco propiedades: isOdometer (booleano), readable (booleano), odometerKm (número decimal sin separador de miles o null), confidence (número de 0 a 1) y message (explicación breve en español).',
  ].join(' ')

  const preferredModel = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash'
  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  })

  const callGemini = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: requestBody,
      signal: AbortSignal.timeout(25000),
    })

  // Gemini recomienda reintentar 429/5xx. La segunda opción usa Flash-Lite,
  // que admite imágenes y salidas estructuradas y tiene cuota independiente.
  const attempts = [preferredModel, preferredModel, 'gemini-2.5-flash-lite']
  let geminiResponse: Response | null = null
  let lastDetail = ''
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    try {
      const current = await callGemini(attempts[attempt])
      if (current.ok) {
        geminiResponse = current
        break
      }
      lastDetail = (await current.text()).slice(0, 1000)
      console.error('Gemini validation request failed', attempts[attempt], current.status, lastDetail)
      if (![429, 500, 502, 503, 504].includes(current.status)) {
        geminiResponse = current
        break
      }
    } catch (error) {
      lastDetail = String(error).slice(0, 1000)
      console.error('Gemini validation transport failed', attempts[attempt], lastDetail)
    }
    if (attempt < attempts.length - 1) await new Promise(resolve => setTimeout(resolve, 600 * (2 ** attempt)))
  }

  if (!geminiResponse) {
    console.error('Gemini validation exhausted all retries', lastDetail)
    return response({ error: 'No se pudo contactar el validador de fotos.' }, 503)
  }

  if (!geminiResponse.ok) {
    // El detalle se mantiene solamente en los registros seguros de la función.
    // Al conductor no se le exponen mensajes internos ni datos de la clave.
    const detail = lastDetail || (await geminiResponse.text()).slice(0, 1000)
    console.error('Gemini validation request definitively failed', geminiResponse.status, detail)
    const normalizedDetail = detail.toLowerCase()
    const diagnostic = normalizedDetail.includes('api key not valid') || normalizedDetail.includes('api_key_invalid')
      ? { code: 'GEMINI_API_KEY_INVALID', status: 401 }
      : normalizedDetail.includes('api key expired')
        ? { code: 'GEMINI_API_KEY_EXPIRED', status: 401 }
        : normalizedDetail.includes('model') && normalizedDetail.includes('not found')
          ? { code: 'GEMINI_MODEL_NOT_FOUND', status: 404 }
          : normalizedDetail.includes('schema') || normalizedDetail.includes('invalid argument')
            ? { code: 'GEMINI_INVALID_REQUEST', status: 422 }
            : { code: `GEMINI_HTTP_${geminiResponse.status}`, status: geminiResponse.status }
    return response({
      error: 'La validación inteligente no está disponible por el momento.',
      code: diagnostic.code,
    }, diagnostic.status)
  }

  let parsed: Record<string, unknown> = {}
  try {
    const payload = await geminiResponse.json()
    const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('').trim()
    parsed = JSON.parse(text || '{}')
  } catch {
    return response({ error: 'No se pudo interpretar la lectura del tablero.' }, 503)
  }

  const isOdometer = parsed.isOdometer === true
  const readable = parsed.readable === true
  const confidence = Math.min(1, Math.max(0, toNumber(parsed.confidence) || 0))
  const odometerKm = toNumber(parsed.odometerKm)
  const message = String(parsed.message || '').slice(0, 240)

  if (!isOdometer) return response({
    available: true,
    isOdometer: false,
    readable: false,
    odometerKm: null,
    confidence,
    message: message || 'La imagen no parece mostrar el tablero de un vehículo. Toma nuevamente la foto del odómetro.',
  })

  if (!readable || odometerKm === null || odometerKm < 0) return response({
    available: true,
    isOdometer: true,
    readable: false,
    odometerKm: null,
    confidence,
    message: message || 'No se distinguen bien los números del odómetro. Enfoca el tablero y toma otra foto.',
  })

  return response({
    available: true,
    isOdometer: true,
    readable: true,
    odometerKm,
    confidence,
    referenceMismatch: minimumKm > 0 && odometerKm < minimumKm,
    message: message || 'Tablero validado correctamente.',
  })
})
