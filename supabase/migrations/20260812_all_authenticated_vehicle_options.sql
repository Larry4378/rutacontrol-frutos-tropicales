-- Autorizado por administración: los choferes pueden consultar la lista
-- completa de vehículos para elegir una movilidad cuando sea necesario.
drop policy if exists driver_reads_authorized_vehicles on public.vehicles;

create policy authenticated_users_read_vehicles
on public.vehicles
for select
to authenticated
using (true);
