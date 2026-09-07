-- Directorio mínimo y seguro para el selector de conductor.
-- No expone códigos de acceso, permisos ni otros datos del perfil.
create or replace function public.list_active_trip_drivers()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select driver.id, driver.full_name
  from public.user_profiles driver
  where driver.role = 'driver'
    and driver.is_active
    and exists (
      select 1
      from public.user_profiles requester
      where requester.id = (select auth.uid())
        and requester.is_active
    )
  order by driver.full_name;
$$;

revoke all on function public.list_active_trip_drivers() from public;
revoke all on function public.list_active_trip_drivers() from anon;
grant execute on function public.list_active_trip_drivers() to authenticated;

-- driver_id conserva al usuario autenticado responsable de crear y transmitir
-- el recorrido. driver_profile_id identifica al conductor elegido en el formulario.
drop policy if exists "users create departure trips" on public.trips;
create policy "users create departure trips"
on public.trips
for insert
to authenticated
with check (
  driver_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles selected_driver
    where selected_driver.id = driver_profile_id
      and selected_driver.role = 'driver'
      and selected_driver.is_active
  )
  and exists (
    select 1
    from public.user_profiles requester
    where requester.id = (select auth.uid())
      and requester.is_active
      and (
        requester.role = 'admin'
        or coalesce((requester.permissions ->> 'departure')::boolean, false)
      )
  )
);

drop policy if exists "users finalize their own trips" on public.trips;
-- La política existente "trips own or admin update" conserva al usuario
-- autenticado como dueño de las actualizaciones y del seguimiento GPS.
