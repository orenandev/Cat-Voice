alter table public.room_members add column pack_ready boolean not null default false;

revoke update on public.room_members from authenticated, anon;
grant update (pack_ready) on public.room_members to authenticated;

create policy "marcar pack pronto" on public.room_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.room_members replica identity full;
