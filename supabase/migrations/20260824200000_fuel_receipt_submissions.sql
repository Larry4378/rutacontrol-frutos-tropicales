-- Comprobantes de combustible: el chofer solo envía la foto y la oficina revisa.
alter table public.fuel_records
  alter column provider drop not null,
  alter column amount drop not null,
  alter column odometer_km drop not null;

alter table public.fuel_records
  add column if not exists fuel_product text,
  add column if not exists gallons numeric check (gallons is null or gallons >= 0),
  add column if not exists review_status text not null default 'Pendiente de revisión'
    check (review_status in ('Pendiente de revisión', 'Datos detectados', 'Revisado')),
  add column if not exists receipt_path text,
  add column if not exists receipt_details jsonb not null default '[]'::jsonb;

create index if not exists fuel_records_created_by_registered_at_idx
  on public.fuel_records (created_by, registered_at desc);

drop policy if exists "fuel own insert" on public.fuel_records;
create policy "fuel driver or admin insert" on public.fuel_records
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.user_profiles profile
      where profile.id = auth.uid()
        and profile.is_active = true
        and (profile.role = 'admin' or coalesce((profile.permissions ->> 'fuel')::boolean, false))
    )
  );

drop policy if exists "fuel admin update" on public.fuel_records;
create policy "fuel admin update" on public.fuel_records
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "fuel admin delete" on public.fuel_records;
create policy "fuel admin delete" on public.fuel_records
  for delete to authenticated
  using ((select private.is_admin()));

drop policy if exists "fuel receipt upload" on storage.objects;
create policy "fuel receipt upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vehicle-evidence'
    and (storage.foldername(name))[1] = 'fuel'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1
      from public.user_profiles profile
      where profile.id = auth.uid()
        and profile.is_active = true
        and (profile.role = 'admin' or coalesce((profile.permissions ->> 'fuel')::boolean, false))
    )
  );

drop policy if exists "fuel receipt read" on storage.objects;
create policy "fuel receipt read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vehicle-evidence'
    and (storage.foldername(name))[1] = 'fuel'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or (select private.is_rutacontrol_admin())
    )
  );
