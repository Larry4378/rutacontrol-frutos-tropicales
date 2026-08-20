-- Permite cerrar una salida desde la llegada, sin dar acceso a recorridos ajenos.
-- El conductor activo solo puede actualizar sus propios viajes; el administrador
-- conserva su acceso completo mediante la función privada de rol.

drop policy if exists "users finalize their own trips" on public.trips;

create policy "users finalize their own trips"
on public.trips
for update
to authenticated
using (
  driver_id = (select auth.uid())
  or (select private.is_rutacontrol_admin())
)
with check (
  (select private.is_rutacontrol_admin())
  or (
    driver_id = (select auth.uid())
    and driver_profile_id = (select auth.uid())
    and exists (
      select 1
      from public.user_profiles profile
      where profile.id = (select auth.uid())
        and profile.is_active
        and coalesce((profile.permissions ->> 'arrival')::boolean, false)
    )
  )
);
