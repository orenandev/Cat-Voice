create or replace function private.clean_display_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 24), '');
$$;

create or replace function private.handle_user_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      private.clean_display_name(new.raw_user_meta_data->'custom_claims'->>'global_name'),
      private.clean_display_name(new.raw_user_meta_data->>'full_name'),
      private.clean_display_name(new.raw_user_meta_data->>'name'),
      'Jogador'
    ),
    null
  )
  on conflict (id) do update set display_name = excluded.display_name;
  return new;
end $$;

alter table public.profiles
  add constraint profiles_display_name_valido check (display_name is null or char_length(display_name) between 1 and 24),
  add constraint profiles_avatar_https check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500));

revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

alter table public.rooms
  add constraint rooms_pack_url_gamebanana check (pack_url is null or pack_url ~ '^https://(www\.)?gamebanana\.com/[A-Za-z0-9/_-]*$'),
  add constraint rooms_pack_key_formato check (
    (pack_source = 'gamebanana' and pack_key ~ '^gb-[0-9]{1,10}$')
    or (pack_source in ('cloud', 'local') and pack_key ~ '^[0-9a-f]{64}$')
  ),
  add constraint rooms_settings_conhecidas check (settings - array['surprise', 'watched'] = '{}'::jsonb);

alter table public.takes
  add constraint takes_path_do_jogador check (
    split_part(path, '/', 1) = room_id::text
    and split_part(path, '/', 2) = user_id::text
    and path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+\.(webm|ogg|m4a)$'
  );

create or replace function private.cloud_chunks_uploaded(p_key text, p_chunks int) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_chunks > 0 and (
    select count(*) from storage.objects o
    where o.bucket_id = 'packs'
      and o.name in (select p_key || '/' || i || '.part' from generate_series(0, p_chunks - 1) i)
  ) = p_chunks;
$$;

create or replace function private.prepare_room() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is not null then
    if (select count(*) from public.rooms where owner_id = v_uid) >= 15 then
      raise exception 'Você já tem salas demais abertas. Encerre alguma antes de criar outra.';
    end if;
    new.owner_id := v_uid;
  end if;
  new.code := public.gen_room_code();
  new.status := 'lobby';
  new.pack_ready := new.pack_source <> 'cloud';
  new.settings := '{}'::jsonb;
  new.created_at := now();
  new.updated_at := now();
  if new.pack_source <> 'cloud' then
    new.pack_chunks := 0;
  elsif new.pack_chunks < 1 then
    raise exception 'Pack na nuvem precisa de pelo menos uma parte';
  end if;
  return new;
end $$;

create or replace function private.guard_room_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (new.owner_id, new.code, new.pack_source, new.pack_key, new.pack_name, new.pack_size, new.pack_chunks, new.pack_url, new.manifest, new.created_at)
     is distinct from
     (old.owner_id, old.code, old.pack_source, old.pack_key, old.pack_name, old.pack_size, old.pack_chunks, old.pack_url, old.manifest, old.created_at) then
    raise exception 'O pack e o dono da sala não podem ser alterados';
  end if;
  if new.pack_ready is distinct from old.pack_ready then
    if not new.pack_ready then
      raise exception 'O pack já foi marcado como pronto';
    end if;
    if new.pack_source = 'cloud' and not private.cloud_chunks_uploaded(new.pack_key, new.pack_chunks) then
      raise exception 'O envio do pack para a nuvem não terminou';
    end if;
  end if;
  if new.max_players is distinct from old.max_players
     and new.max_players < (select count(*) from public.room_members where room_id = new.id) then
    raise exception 'Já tem mais jogadores na sala do que esse limite';
  end if;
  return new;
end $$;

revoke execute on function private.prepare_room(), private.guard_room_update(), private.cloud_chunks_uploaded(text, int), private.clean_display_name(text)
  from public, anon, authenticated;

create trigger rooms_prepare before insert on public.rooms
  for each row execute function private.prepare_room();
create trigger rooms_guard_update before update on public.rooms
  for each row execute function private.guard_room_update();

create or replace function private.can_upload_take(p_room text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = (select auth.uid())
    where r.id::text = p_room and r.status = 'recording'
  );
$$;

drop policy "takes: jogador envia" on storage.objects;
drop policy "takes: jogador substitui" on storage.objects;

create policy "takes: jogador envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'takes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.can_upload_take((storage.foldername(name))[1])
  );
create policy "takes: jogador substitui" on storage.objects for update to authenticated
  using (bucket_id = 'takes' and (storage.foldername(name))[2] = (select auth.uid())::text)
  with check (
    bucket_id = 'takes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.can_upload_take((storage.foldername(name))[1])
  );

drop policy "packs: dono envia" on storage.objects;
drop policy "packs: dono reenvia" on storage.objects;

create policy "packs: dono envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'packs'
    and name ~ '^[0-9a-f]{64}/[0-9]{1,2}\.part$'
    and private.owns_cloud_pack((storage.foldername(name))[1])
    and not private.cloud_pack_ready((storage.foldername(name))[1])
  );
create policy "packs: dono reenvia" on storage.objects for update to authenticated
  using (bucket_id = 'packs' and private.owns_cloud_pack((storage.foldername(name))[1]) and not private.cloud_pack_ready((storage.foldername(name))[1]))
  with check (
    bucket_id = 'packs'
    and name ~ '^[0-9a-f]{64}/[0-9]{1,2}\.part$'
    and private.owns_cloud_pack((storage.foldername(name))[1])
    and not private.cloud_pack_ready((storage.foldername(name))[1])
  );
