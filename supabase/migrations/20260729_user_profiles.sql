create schema if not exists private;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'driver')) default 'driver',
  access_code text unique,
  is_active boolean not null default true,
  permissions jsonb not null default '{"departure": true, "arrival": true, "trips": true, "fuel": false, "maintenance": false}'::jsonb,
  qr_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

create or replace function private.is_rutacontrol_admin()
returns boolean language sql stable security definer
set search_path = public, auth, pg_temp
as $$ select exists (select 1 from public.user_profiles where id = auth.uid() and role = 'admin' and is_active); $$;

revoke all on function private.is_rutacontrol_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_rutacontrol_admin() to authenticated;
grant select on public.user_profiles to authenticated;

create policy profile_owner_or_admin_reads on public.user_profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_rutacontrol_admin()));

create policy admin_manages_profiles on public.user_profiles for all to authenticated
using ((select private.is_rutacontrol_admin())) with check ((select private.is_rutacontrol_admin()));
