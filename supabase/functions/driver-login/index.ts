import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { accessCode, pin } = await req.json()
  const qrToken = String(accessCode || '').trim().toUpperCase()
  if (!qrToken || !/^\d{6}$/.test(String(pin || ''))) return reply({ error: 'Escanea tu QR e ingresa tu PIN de 6 números.' }, 400)
  const url = Deno.env.get('SUPABASE_URL')!
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: profile } = await service.from('user_profiles').select('id,is_active').eq('access_code', qrToken).eq('role', 'driver').maybeSingle()
  if (!profile || !profile.is_active) return reply({ error: 'Este acceso no está activo.' }, 401)
  const { data: authUser, error: authError } = await service.auth.admin.getUserById(profile.id)
  if (authError || !authUser.user?.email) return reply({ error: 'No se pudo encontrar la cuenta.' }, 401)
  const login = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data, error } = await login.auth.signInWithPassword({ email: authUser.user.email, password: String(pin) })
  return error ? reply({ error: 'PIN incorrecto.' }, 401) : reply({ session: data.session })
})
