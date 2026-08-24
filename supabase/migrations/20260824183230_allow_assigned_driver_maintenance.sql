-- Los conductores activos con permiso de mantenimiento solo pueden
-- registrar y consultar mantenimientos de sus vehículos autorizados.
create or replace function private.can_manage_assigned_maintenance(target_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.id = auth.uid()
      and profile.role = 'driver'
      and profile.is_active
      and coalesce((profile.permissions ->> 'maintenance')::boolean, false)
      and (
        profile.permissions ->> 'assignedVehicleId' = target_vehicle_id::text
        or (
          jsonb_typeof(profile.permissions -> 'allowedVehicleIds') = 'array'
          and exists (
            select 1
            from jsonb_array_elements_text(profile.permissions -> 'allowedVehicleIds') as permitted_vehicle(id)
            where permitted_vehicle.id = target_vehicle_id::text
          )
        )
      )
  );
$$;

drop policy if exists "maintenance admin read" on public.maintenance_records;
drop policy if exists "maintenance admin insert" on public.maintenance_records;
drop policy if exists "maintenance admin update" on public.maintenance_records;
drop policy if exists "maintenance admin delete" on public.maintenance_records;

create policy "maintenance read authorized" on public.maintenance_records
for select to authenticated
using (
  (select private.is_rutacontrol_admin())
  or (created_by = (select auth.uid()) and (select private.can_manage_assigned_maintenance(vehicle_id)))
);

create policy "maintenance insert authorized" on public.maintenance_records
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and ((select private.is_rutacontrol_admin()) or (select private.can_manage_assigned_maintenance(vehicle_id)))
);

create policy "maintenance update authorized" on public.maintenance_records
for update to authenticated
using (
  (select private.is_rutacontrol_admin())
  or (created_by = (select auth.uid()) and (select private.can_manage_assigned_maintenance(vehicle_id)))
)
with check (
  (select private.is_rutacontrol_admin())
  or (created_by = (select auth.uid()) and (select private.can_manage_assigned_maintenance(vehicle_id)))
);

create policy "maintenance delete authorized" on public.maintenance_records
for delete to authenticated
using (
  (select private.is_rutacontrol_admin())
  or (created_by = (select auth.uid()) and (select private.can_manage_assigned_maintenance(vehicle_id)))
);
