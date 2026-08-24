-- Protección para clientes que aún no hayan actualizado la aplicación.
alter table public.maintenance_records
  alter column service_type set default 'Afinamiento general';
