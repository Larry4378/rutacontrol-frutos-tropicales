create or replace function private.list_active_trip_drivers()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select driver.id, driver.full_name
  from public.user_profiles driver
  where driver.role = 'driver'
    and driver.is_active
    and exists (
      select 1
      from public.user_profiles requester
      where requester.id = (select auth.uid())
        and requester.is_active
    )
  order by driver.full_name;
$$;

revoke all on function private.list_active_trip_drivers() from public;
revoke all on function private.list_active_trip_drivers() from anon;
grant execute on function private.list_active_trip_drivers() to authenticated;

create or replace function public.list_active_trip_drivers()
returns table (id uuid, full_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select directory.id, directory.full_name
  from private.list_active_trip_drivers() directory;
$$;

revoke all on function public.list_active_trip_drivers() from public;
revoke all on function public.list_active_trip_drivers() from anon;
grant execute on function public.list_active_trip_drivers() to authenticated;
