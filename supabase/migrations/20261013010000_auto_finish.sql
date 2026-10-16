create or replace function private.auto_finish_room() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_pending int;
begin
  select * into v_room from public.rooms where id = new.room_id for update;
  if not found or v_room.status <> 'recording' then
    return new;
  end if;
  select count(*) into v_pending
  from jsonb_array_elements(v_room.manifest->'clips') c
  where exists (
      select 1 from public.character_claims cc
      where cc.room_id = v_room.id and (c->'characters') ? cc.character
    )
    and not exists (
      select 1 from public.takes t
      where t.room_id = v_room.id and t.clip_id = c->>'id'
    );
  if v_pending = 0 then
    update public.rooms set status = 'finished' where id = v_room.id;
  end if;
  return new;
end $$;

revoke execute on function private.auto_finish_room() from public, anon, authenticated;

create trigger takes_auto_finish after insert or update on public.takes
  for each row execute function private.auto_finish_room();
