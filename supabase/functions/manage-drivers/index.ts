import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') || ''
  const client = createClient(url, serviceKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await client.auth.getUser()
  if (!user) return response({ error: 'Sesión no válida.' }, 401)
  const { data: admin } = await client.from('user_profiles').select('role,is_active').eq('id', user.id).maybeSingle()
  if (admin?.role !== 'admin' || !admin.is_active) return response({ error: 'Solo el administrador puede gestionar usuarios.' }, 403)

  const body = await req.json()
  const action = body.action
  if (action === 'create') {
    const fullName = String(body.fullName || '').trim()
    const accessCode = String(body.accessCode || '').trim().toUpperCase()
    const pin = String(body.pin || '')
    if (!fullName || !/^[A-Z0-9_-]{4,20}$/.test(accessCode) || !/^\d{6}$/.test(pin)) return response({ error: 'Completa nombre, código de 4 a 20 caracteres y PIN de 6 números.' }, 400)
    const internalEmail = `${accessCode.toLowerCase()}.${crypto.randomUUID().slice(0, 8)}@drivers.rutacontrol.local`
    const { data: created, error: createError } = await client.auth.admin.createUser({ email: internalEmail, password: pin, email_confirm: true, app_metadata: { role: 'driver' }, user_metadata: { full_name: fullName } })
    if (createError || !created.user) return response({ error: createError?.message || 'No se pudo crear el acceso.' }, 400)
    const { data: profile, error: profileError } = await client.from('user_profiles').insert({ id: created.user.id, full_name: fullName, role: 'driver', access_code: accessCode }).select('id,full_name,role,access_code,is_active,qr_token,created_at').single()
    if (profileError) { await client.auth.admin.deleteUser(created.user.id); return response({ error: profileError.message }, 400) }
    return response({ profile })
  }
  if (action === 'set-active') {
    const { data: profile, error } = await client.from('user_profiles').update({ is_active: Boolean(body.isActive) }).eq('id', body.id).eq('role', 'driver').select('id,full_name,role,access_code,is_active,qr_token,created_at').single()
    return error ? response({ error: error.message }, 400) : response({ profile })
  }
  if (action === 'reset-pin') {
    const pin = String(body.pin || '')
    if (!/^\d{6}$/.test(pin)) return response({ error: 'El PIN debe tener exactamente 6 números.' }, 400)
    const { error } = await client.auth.admin.updateUserById(body.id, { password: pin })
    return error ? response({ error: error.message }, 400) : response({ ok: true })
  }
  if (action === 'renew-qr') {
    const { data: profile, error } = await client.from('user_profiles').update({ qr_token: crypto.randomUUID() }).eq('id', body.id).eq('role', 'driver').select('id,full_name,role,access_code,is_active,qr_token,created_at').single()
    return error ? response({ error: error.message }, 400) : response({ profile })
  }
  return response({ error: 'Acción no reconocida.' }, 400)
})
