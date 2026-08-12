-- Los administradores ven toda la flota; cada chofer solo ve su vehículo
-- asignado y las movilidades adicionales autorizadas desde Usuarios.
alter table public.vehicles enable row level security;

drop policy if exists authenticated_users_read_vehicles on public.vehicles;
drop policy if exists driver_reads_authorized_vehicles on public.vehicles;

create policy driver_reads_authorized_vehicles
on public.vehicles
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and (
        profile.role = 'admin'
        or (
          profile.role = 'driver'
          and (
            profile.permissions ->> 'assignedVehicleId' = public.vehicles.id::text
            or coalesce(profile.permissions -> 'allowedVehicleIds', '[]'::jsonb) ? public.vehicles.id::text
          )
        )
      )
  )
);
