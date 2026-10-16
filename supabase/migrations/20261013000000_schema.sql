create schema if not exists private;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function private.handle_user_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->'custom_claims'->>'global_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, 'jogador'), '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_user_profile();
create trigger on_auth_user_updated after update of raw_user_meta_data on auth.users
  for each row execute function private.handle_user_profile();

create or replace function public.gen_room_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text;
begin
  loop
    result := '';
    for i in 1..6 loop
      result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = result);
  end loop;
  return result;
end $$;

create type public.room_status as enum ('lobby', 'recording', 'finished');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.gen_room_code(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  max_players int not null default 5 check (max_players between 2 and 5),
  status public.room_status not null default 'lobby',
  pack_source text not null check (pack_source in ('cloud', 'gamebanana', 'local')),
  pack_key text not null check (char_length(pack_key) between 1 and 128 and pack_key ~ '^[a-z0-9:_-]+$'),
  pack_name text check (char_length(pack_name) <= 200),
  pack_size bigint check (pack_size >= 0),
  pack_chunks int not null default 0 check (pack_chunks between 0 and 64),
  pack_ready boolean not null default false,
  pack_url text check (char_length(pack_url) <= 300),
  manifest jsonb not null check (
    jsonb_typeof(manifest->'clips') = 'array'
    and jsonb_typeof(manifest->'characters') = 'array'
    and pg_column_size(manifest) < 262144
  ),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_owner_idx on public.rooms(owner_id);
create index rooms_pack_key_idx on public.rooms(pack_key);
alter table public.rooms enable row level security;

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on public.room_members(user_id);
alter table public.room_members enable row level security;

create table public.character_claims (
  room_id uuid not null references public.rooms(id) on delete cascade,
  character text not null check (char_length(character) between 1 and 120),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, character)
);
create index character_claims_user_idx on public.character_claims(user_id);
alter table public.character_claims enable row level security;

create table public.takes (
  room_id uuid not null references public.rooms(id) on delete cascade,
  clip_id text not null check (char_length(clip_id) between 1 and 200),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  path text not null check (char_length(path) <= 400),
  duration_ms int not null check (duration_ms between 0 and 90000),
  offset_ms int not null default 0 check (offset_ms between -5000 and 5000),
  updated_at timestamptz not null default now(),
  primary key (room_id, clip_id)
);
create index takes_user_idx on public.takes(user_id);
alter table public.takes enable row level security;

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger rooms_touch before update on public.rooms
  for each row execute function private.touch_updated_at();
create trigger takes_touch before update on public.takes
  for each row execute function private.touch_updated_at();

create or replace function private.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.room_members where room_id = p_room and user_id = (select auth.uid()));
$$;

create or replace function private.is_room_owner(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rooms where id = p_room and owner_id = (select auth.uid()));
$$;

create or replace function private.is_room_member_text(p_room text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.room_members where room_id::text = p_room and user_id = (select auth.uid()));
$$;

create or replace function private.is_room_owner_text(p_room text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rooms where id::text = p_room and owner_id = (select auth.uid()));
$$;

create or replace function private.can_claim_character(p_room uuid, p_character text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = (select auth.uid())
    where r.id = p_room
      and r.status = 'lobby'
      and r.manifest->'characters' @> jsonb_build_array(jsonb_build_object('name', p_character))
  );
$$;

create or replace function private.can_release_character(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rooms r where r.id = p_room and r.status = 'lobby');
$$;

create or replace function private.can_record_clip(p_room uuid, p_clip text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.rooms r
    cross join lateral jsonb_array_elements(r.manifest->'clips') c
    join public.character_claims cc on cc.room_id = r.id and cc.user_id = (select auth.uid())
    where r.id = p_room
      and r.status = 'recording'
      and c->>'id' = p_clip
      and (c->'characters') ? cc.character
  );
$$;

create or replace function private.can_read_pack(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = (select auth.uid())
    where r.pack_key = p_key and r.pack_source = 'cloud'
  );
$$;

create or replace function private.owns_cloud_pack(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms
    where pack_key = p_key and pack_source = 'cloud' and owner_id = (select auth.uid())
  );
$$;

create or replace function private.cloud_pack_ready(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rooms where pack_key = p_key and pack_source = 'cloud' and pack_ready);
$$;

create or replace function private.add_owner_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.room_members (room_id, user_id) values (new.id, new.owner_id)
  on conflict do nothing;
  return new;
end $$;
create trigger rooms_owner_member after insert on public.rooms
  for each row execute function private.add_owner_membership();

create or replace function private.cleanup_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.character_claims where room_id = old.room_id and user_id = old.user_id;
  return old;
end $$;
create trigger room_members_cleanup after delete on public.room_members
  for each row execute function private.cleanup_member();

create or replace function public.join_room(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_count int;
begin
  if (select auth.uid()) is null then
    raise exception 'Faça login para entrar na sala';
  end if;
  select * into v_room from public.rooms where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'Sala não encontrada';
  end if;
  if exists (select 1 from public.room_members where room_id = v_room.id and user_id = (select auth.uid())) then
    return v_room.id;
  end if;
  select count(*) into v_count from public.room_members where room_id = v_room.id;
  if v_count >= v_room.max_players then
    raise exception 'Sala cheia (% de % jogadores)', v_count, v_room.max_players;
  end if;
  insert into public.room_members (room_id, user_id) values (v_room.id, (select auth.uid()));
  return v_room.id;
end $$;

create or replace function public.room_preview(p_code text)
returns table (room_id uuid, name text, owner_name text, owner_avatar text, member_count int, max_players int, pack_name text, status public.room_status, is_member boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, p.display_name, p.avatar_url,
    (select count(*)::int from public.room_members m where m.room_id = r.id),
    r.max_players, r.pack_name, r.status,
    exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = (select auth.uid()))
  from public.rooms r
  join public.profiles p on p.id = r.owner_id
  where r.code = upper(trim(p_code)) and (select auth.uid()) is not null;
$$;

create or replace function public.pack_refcount(p_key text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.rooms where pack_key = p_key and pack_source = 'cloud';
$$;

create or replace function public.cloud_pack_available(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.cloud_pack_ready(p_key);
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.join_room(text), public.room_preview(text), public.pack_refcount(text),
  public.cloud_pack_available(text), public.gen_room_code() to authenticated;
revoke execute on function private.add_owner_membership(), private.cleanup_member(), private.handle_user_profile(), private.touch_updated_at()
  from public, anon, authenticated;

create policy "perfis visiveis para logados" on public.profiles for select to authenticated using (true);
create policy "editar proprio perfil" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "membros veem a sala" on public.rooms for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_room_member(id));
create policy "criar sala" on public.rooms for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "dono edita sala" on public.rooms for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "dono apaga sala" on public.rooms for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "membros veem membros" on public.room_members for select to authenticated
  using (private.is_room_member(room_id));
create policy "sair ou expulsar" on public.room_members for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_room_owner(room_id));

create policy "membros veem personagens" on public.character_claims for select to authenticated
  using (private.is_room_member(room_id));
create policy "escolher personagem" on public.character_claims for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_claim_character(room_id, character));
create policy "soltar personagem" on public.character_claims for delete to authenticated
  using ((user_id = (select auth.uid()) or private.is_room_owner(room_id)) and private.can_release_character(room_id));

create policy "membros veem gravacoes" on public.takes for select to authenticated
  using (private.is_room_member(room_id));
create policy "enviar gravacao" on public.takes for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_record_clip(room_id, clip_id));
create policy "regravar" on public.takes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.can_record_clip(room_id, clip_id));
create policy "apagar gravacao" on public.takes for delete to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.rooms, public.room_members, public.character_claims, public.takes;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('packs', 'packs', false, 50000000, array['application/octet-stream']),
  ('takes', 'takes', false, 10000000, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav'])
on conflict (id) do nothing;

create policy "packs: membros leem" on storage.objects for select to authenticated
  using (bucket_id = 'packs' and private.can_read_pack((storage.foldername(name))[1]));
create policy "packs: dono envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'packs'
    and private.owns_cloud_pack((storage.foldername(name))[1])
    and not private.cloud_pack_ready((storage.foldername(name))[1])
  );
create policy "packs: dono reenvia" on storage.objects for update to authenticated
  using (bucket_id = 'packs' and private.owns_cloud_pack((storage.foldername(name))[1]) and not private.cloud_pack_ready((storage.foldername(name))[1]))
  with check (bucket_id = 'packs' and private.owns_cloud_pack((storage.foldername(name))[1]) and not private.cloud_pack_ready((storage.foldername(name))[1]));
create policy "packs: dono apaga" on storage.objects for delete to authenticated
  using (
    bucket_id = 'packs'
    and private.owns_cloud_pack((storage.foldername(name))[1])
    and public.pack_refcount((storage.foldername(name))[1]) <= 1
  );

create policy "takes: membros ouvem" on storage.objects for select to authenticated
  using (bucket_id = 'takes' and private.is_room_member_text((storage.foldername(name))[1]));
create policy "takes: jogador envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'takes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.is_room_member_text((storage.foldername(name))[1])
  );
create policy "takes: jogador substitui" on storage.objects for update to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[2] = (select auth.uid())::text)
  with check (bucket_id = 'takes' and (storage.foldername(name))[2] = (select auth.uid())::text and private.is_room_member_text((storage.foldername(name))[1]));
create policy "takes: jogador apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "takes: dono da sala limpa" on storage.objects for delete to authenticated
  using (bucket_id = 'takes' and private.is_room_owner_text((storage.foldername(name))[1]));
