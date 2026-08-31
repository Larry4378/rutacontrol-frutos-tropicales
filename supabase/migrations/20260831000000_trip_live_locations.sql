-- Una sola posición vigente por recorrido. Evita reescribir todo el JSON del
-- trayecto cada segundo y permite que el mapa administrativo reciba cambios
-- pequeños mediante Supabase Realtime.
create table if not exists public.trip_live_locations (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision not null check (accuracy >= 0),
  speed double precision check (speed is null or speed >= 0),
  heading double precision check (heading is null or (heading >= 0 and heading <= 360)),
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.trip_live_locations enable row level security;

revoke all on public.trip_live_locations from anon;
grant select, insert, update on public.trip_live_locations to authenticated;

drop policy if exists "live locations own trip or admin read" on public.trip_live_locations;
create policy "live locations own trip or admin read"
on public.trip_live_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.trips trip
    where trip.id = trip_live_locations.trip_id
      and (
        trip.driver_id = (select auth.uid())
        or (select private.is_rutacontrol_admin())
      )
  )
);

drop policy if exists "drivers create own live location" on public.trip_live_locations;
create policy "drivers create own live location"
on public.trip_live_locations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.trips trip
    join public.user_profiles profile on profile.id = (select auth.uid())
    where trip.id = trip_live_locations.trip_id
      and trip.driver_id = (select auth.uid())
      and trip.end_km is null
      and trip.status <> 'Finalizado'
      and profile.is_active
  )
);

drop policy if exists "drivers update own live location" on public.trip_live_locations;
create policy "drivers update own live location"
on public.trip_live_locations
for update
to authenticated
using (
  exists (
    select 1
    from public.trips trip
    where trip.id = trip_live_locations.trip_id
      and trip.driver_id = (select auth.uid())
      and trip.end_km is null
      and trip.status <> 'Finalizado'
  )
)
with check (
  exists (
    select 1
    from public.trips trip
    join public.user_profiles profile on profile.id = (select auth.uid())
    where trip.id = trip_live_locations.trip_id
      and trip.driver_id = (select auth.uid())
      and trip.end_km is null
      and trip.status <> 'Finalizado'
      and profile.is_active
  )
);

-- Postgres Changes es suficiente aquí: solo existe una fila pequeña por viaje.
-- La comprobación hace que la migración sea segura si la tabla ya fue añadida.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_live_locations'
  ) then
    alter publication supabase_realtime add table public.trip_live_locations;
  end if;
end
$$;
