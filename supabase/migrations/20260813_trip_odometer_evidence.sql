-- Evidencias privadas de odómetro: la imagen queda en Storage y el kilometraje en trips.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehicle-evidence',
  'vehicle-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "drivers create own trips" on public.trips;
create policy "users create departure trips"
on public.trips
for insert
to authenticated
with check (
  driver_id = (select auth.uid())
  and driver_profile_id = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
      and (
        profile.role = 'admin'
        or coalesce((profile.permissions ->> 'departure')::boolean, false)
      )
  )
);

drop policy if exists "odometer evidence upload" on storage.objects;
create policy "odometer evidence upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vehicle-evidence'
  and (storage.foldername(name))[1] = 'odometer'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

drop policy if exists "odometer evidence read" on storage.objects;
create policy "odometer evidence read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vehicle-evidence'
  and (
    (storage.foldername(name))[2] = (select auth.uid()::text)
    or (select private.is_rutacontrol_admin())
  )
);
