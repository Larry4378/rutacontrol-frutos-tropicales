create policy "maintenance admin update" on public.maintenance_records
for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()) and created_by = (select auth.uid()));

create policy "maintenance admin delete" on public.maintenance_records
for delete to authenticated
using ((select private.is_admin()));
