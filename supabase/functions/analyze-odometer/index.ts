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

  const geminiKey = Deno.env.get('GEMINI_API_KEY')
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
    'Primero decide si muestra realmente un tablero/instrumental de vehículo con un odómetro visible.',
    'No confundas la velocidad, la hora, el número de marcha, la placa, una fecha, un recibo o cualquier texto con el kilometraje.',
    'Acepta tableros de motos, autos, camionetas y camiones, tanto digitales como analógicos.',
    'Si la foto no es un tablero o si los dígitos del odómetro no se distinguen con seguridad, indica que no es legible.',
    `Es una lectura de ${stage}. El kilometraje de referencia mínimo es ${minimumKm} km.`,
    'Devuelve únicamente los datos solicitados. El kilometraje debe ser un número decimal sin separador de miles.',
  ].join(' ')

  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash'
  let geminiResponse: Response
  try {
    geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              isOdometer: { type: 'BOOLEAN' },
              readable: { type: 'BOOLEAN' },
              odometerKm: { type: 'NUMBER' },
              confidence: { type: 'NUMBER' },
              message: { type: 'STRING' },
            },
            required: ['isOdometer', 'readable', 'confidence', 'message'],
          },
        },
      }),
    })
  } catch {
    return response({ error: 'No se pudo contactar el validador de fotos.' }, 503)
  }

  if (!geminiResponse.ok) {
    // No devolvemos detalles del proveedor ni credenciales al teléfono.
    return response({ error: 'La validación inteligente no está disponible por el momento.' }, 503)
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

  if (minimumKm > 0 && odometerKm < minimumKm) return response({
    available: true,
    isOdometer: true,
    readable: false,
    odometerKm: null,
    confidence,
    message: `La lectura (${odometerKm} km) es menor que el kilometraje de referencia (${minimumKm} km). Revisa la foto o escribe el valor manualmente.`,
  })

  return response({
    available: true,
    isOdometer: true,
    readable: true,
    odometerKm,
    confidence,
    message: message || 'Tablero validado correctamente.',
  })
})
