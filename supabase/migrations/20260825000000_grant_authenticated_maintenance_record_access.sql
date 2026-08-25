-- Las políticas RLS existentes ya limitan quién puede leer, crear, editar o eliminar.
-- Este permiso habilita esas operaciones para sesiones autenticadas; no abre acceso anónimo.
grant select, insert, update, delete on table public.maintenance_records to authenticated;
