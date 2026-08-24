-- La administración de RutaControl se guarda en public.user_profiles.
-- Estas políticas usan la misma validación que la interfaz de Usuarios.
drop policy if exists "maintenance admin read" on public.maintenance_records;
drop policy if exists "maintenance admin insert" on public.maintenance_records;
drop policy if exists "maintenance admin update" on public.maintenance_records;
drop policy if exists "maintenance admin delete" on public.maintenance_records;

create policy "maintenance admin read" on public.maintenance_records
for select to authenticated
using ((select private.is_rutacontrol_admin()));

create policy "maintenance admin insert" on public.maintenance_records
for insert to authenticated
with check (
  (select private.is_rutacontrol_admin())
  and created_by = (select auth.uid())
);

create policy "maintenance admin update" on public.maintenance_records
for update to authenticated
using ((select private.is_rutacontrol_admin()))
with check (
  (select private.is_rutacontrol_admin())
  and created_by = (select auth.uid())
);

create policy "maintenance admin delete" on public.maintenance_records
for delete to authenticated
using ((select private.is_rutacontrol_admin()));
