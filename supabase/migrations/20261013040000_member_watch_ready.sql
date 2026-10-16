alter table public.room_members add column watch_ready boolean not null default false;
grant update (pack_ready, watch_ready) on public.room_members to authenticated;
