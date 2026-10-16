import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Claim, Member, Room, Take } from "./types";

export type PackPresence = { phase: string };
export type Playback = { playing: boolean; time: number };

export type RoomData = {
  room: Room | null;
  members: Member[];
  claims: Claim[];
  takes: Take[];
  online: Set<string>;
  packStatus: Record<string, PackPresence>;
  announce: (status: PackPresence) => void;
  setWatchReady: (ready: boolean) => Promise<void>;
  sendPlayback: (state: Playback) => void;
  onPlayback: (handler: ((state: Playback) => void) | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  notify: () => void;
};

const OFFLINE_AFTER = 20000;
const POLL_EVERY = 8000;

function computeOnline(present: Set<string>, seen: Record<string, number>) {
  const now = Date.now();
  const online = new Set(present);
  for (const [uid, at] of Object.entries(seen)) if (now - at < OFFLINE_AFTER) online.add(uid);
  return online;
}

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function keepIfEqual<T>(next: T) {
  return (prev: T) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
}

export function useRoom(roomId: string | undefined, userId: string | undefined): RoomData {
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [takes, setTakes] = useState<Take[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [packStatus, setPackStatus] = useState<Record<string, PackPresence>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mine = useRef<PackPresence>({ phase: "idle" });
  const tracking = useRef(false);
  const lastSeen = useRef<Record<string, number>>({});
  const presentNow = useRef<Set<string>>(new Set());
  const playbackHandler = useRef<((state: Playback) => void) | null>(null);
  const dataChannel = useRef<RealtimeChannel | null>(null);
  const presenceChannel = useRef<RealtimeChannel | null>(null);
  const pending = useRef<number | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    const [r, m, c, t] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
      supabase
        .from("room_members")
        .select("room_id, user_id, joined_at, pack_ready, watch_ready, profile:profiles(id, display_name, avatar_url)")
        .eq("room_id", roomId)
        .order("joined_at"),
      supabase.from("character_claims").select("room_id, character, user_id").eq("room_id", roomId).order("created_at"),
      supabase.from("takes").select("*").eq("room_id", roomId).order("clip_id"),
    ]);
    if (r.error) {
      if (!loaded.current) {
        setError("Não foi possível carregar a sala. Verifique a conexão, a página tenta de novo sozinha.");
        setLoading(false);
      }
      return;
    }
    loaded.current = true;
    if (!r.data) setError("Sala não encontrada ou você não faz parte dela.");
    else setError(null);
    setRoom(keepIfEqual((r.data as Room | null) ?? null));
    if (!m.error) setMembers(keepIfEqual((m.data as unknown as Member[]) ?? []));
    if (!c.error) setClaims(keepIfEqual((c.data as Claim[]) ?? []));
    if (!t.error) setTakes(keepIfEqual((t.data as Take[]) ?? []));
    setLoading(false);
  }, [roomId]);

  const scheduleRefresh = useCallback(() => {
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      void refresh();
    }, 150);
  }, [refresh]);

  useEffect(() => {
    if (!roomId || !userId) return;
    setLoading(true);
    void refresh();

    const data = supabase.channel(`room:${roomId}`, { config: { broadcast: { self: false } } });
    for (const table of ["rooms", "room_members", "character_claims", "takes"]) {
      data.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: table === "rooms" ? `id=eq.${roomId}` : `room_id=eq.${roomId}` },
        scheduleRefresh,
      );
    }
    data.on("broadcast", { event: "sync" }, scheduleRefresh);
    data.on("broadcast", { event: "playback" }, ({ payload }) => playbackHandler.current?.(payload as Playback));
    data.subscribe((status) => status === "SUBSCRIBED" && scheduleRefresh());
    dataChannel.current = data;

    const presence = supabase.channel(`presence:${roomId}`, { config: { presence: { key: userId } } });
    presence.on("presence", { event: "sync" }, () => {
      const state = presence.presenceState<{ pack?: PackPresence }>();
      const now = Date.now();
      presentNow.current = new Set(Object.keys(state));
      for (const uid of presentNow.current) lastSeen.current[uid] = now;
      setOnline(computeOnline(presentNow.current, lastSeen.current));
      const next: Record<string, PackPresence> = {};
      for (const [uid, metas] of Object.entries(state)) {
        const last = metas[metas.length - 1];
        if (last?.pack) next[uid] = last.pack;
      }
      setPackStatus((prev) => ({ ...prev, ...next }));
    });
    presence.subscribe((status) => {
      tracking.current = status === "SUBSCRIBED";
      if (tracking.current) void presence.track({ pack: mine.current }).catch(() => undefined);
    });
    presenceChannel.current = presence;

    const retrack = () => {
      if (tracking.current) void presence.track({ pack: mine.current }).catch(() => undefined);
    };
    const onFocus = () => {
      scheduleRefresh();
      retrack();
    };
    const onVisible = () => document.visibilityState === "visible" && onFocus();
    const poll = window.setInterval(() => document.visibilityState === "visible" && void refresh(), POLL_EVERY);
    const keepAlive = window.setInterval(retrack, 30000);
    const recheck = window.setInterval(() => {
      const now = Date.now();
      for (const uid of presentNow.current) lastSeen.current[uid] = now;
      setOnline((prev) => {
        const next = computeOnline(presentNow.current, lastSeen.current);
        return sameSet(prev, next) ? prev : next;
      });
    }, 5000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(keepAlive);
      window.clearInterval(recheck);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      dataChannel.current = null;
      presenceChannel.current = null;
      tracking.current = false;
      void supabase.removeChannel(data);
      void supabase.removeChannel(presence);
    };
  }, [roomId, userId, refresh, scheduleRefresh]);

  const notify = useCallback(() => {
    void dataChannel.current?.send({ type: "broadcast", event: "sync", payload: {} });
  }, []);

  const announce = useCallback((status: PackPresence) => {
    if (mine.current.phase === status.phase) return;
    mine.current = status;
    if (tracking.current) void presenceChannel.current?.track({ pack: status }).catch(() => undefined);
  }, []);

  const setWatchReady = useCallback(
    async (ready: boolean) => {
      if (!roomId || !userId) return;
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, watch_ready: ready } : m)));
      const { error } = await supabase.from("room_members").update({ watch_ready: ready }).eq("room_id", roomId).eq("user_id", userId);
      if (!error) void dataChannel.current?.send({ type: "broadcast", event: "sync", payload: {} });
    },
    [roomId, userId],
  );

  const sendPlayback = useCallback((state: Playback) => {
    void dataChannel.current?.send({ type: "broadcast", event: "playback", payload: state });
  }, []);

  const onPlayback = useCallback((handler: ((state: Playback) => void) | null) => {
    playbackHandler.current = handler;
  }, []);

  return { room, members, claims, takes, online, packStatus, announce, setWatchReady, sendPlayback, onPlayback, loading, error, refresh, notify };
}
