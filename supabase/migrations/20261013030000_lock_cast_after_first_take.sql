create or replace function private.guard_room_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'finished' then
      raise exception 'A sessão já terminou';
    end if;
    if new.status = 'lobby' and exists (select 1 from public.takes where room_id = new.id) then
      raise exception 'Já tem fala gravada: não dá para reabrir a escolha de elenco';
    end if;
  end if;
  return new;
end $$;

revoke execute on function private.guard_room_status() from public, anon, authenticated;

create trigger rooms_guard_status before update of status on public.rooms
  for each row execute function private.guard_room_status();
