import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CircleCheck, Crown, Download, Flag, LogOut, Play, RotateCcw, Trash2, UserMinus, UserRound, WifiOff, X } from "lucide-react";
import { Avatar, Spinner } from "../ui";
import { useToast } from "../Toast";
import { errorMessage, supabase } from "../../lib/supabase";
import { deleteRoom, leaveRoom } from "../../lib/roomActions";
import type { RoomData } from "../../lib/useRoom";
import type { PackState } from "../../lib/usePack";
import type { RoomStatus } from "../../lib/types";

export function Cast({
  data,
  userId,
  packState,
  onStartRecording,
}: {
  data: RoomData;
  userId: string;
  packState: PackState;
  onStartRecording: () => void;
}) {
  const { room, members, claims, takes, online, packStatus, notify, refresh } = data;
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  if (!room) return null;

  const isOwner = room.owner_id === userId;
  const pack = packState.phase === "ready" ? packState.pack : null;
  const memberOf = (uid: string) => members.find((m) => m.user_id === uid);
  const lobby = room.status === "lobby";

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      notify();
      await refresh();
      if (success) toast(success);
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(null);
    }
  };

  const toggleCharacter = (name: string) => {
    const claim = claims.find((c) => c.character === name);
    if (!lobby) return toast("O elenco está travado durante a gravação.", true);
    if (claim && claim.user_id !== userId && !isOwner) return;
    void run(`char:${name}`, async () => {
      const { error } = claim
        ? await supabase.from("character_claims").delete().eq("room_id", room.id).eq("character", name)
        : await supabase.from("character_claims").insert({ room_id: room.id, character: name, user_id: userId });
      if (error) throw error.code === "23505" ? new Error("Alguém pegou esse personagem antes.") : error;
    });
  };

  const setStatus = (status: RoomStatus, success: string) =>
    run(`status:${status}`, async () => {
      const { error } = await supabase.from("rooms").update({ status }).eq("id", room.id);
      if (error) throw error;
      if (status === "recording") onStartRecording();
    }, success);

  const kick = (uid: string) =>
    run(`kick:${uid}`, async () => {
      const { error } = await supabase.from("room_members").delete().eq("room_id", room.id).eq("user_id", uid);
      if (error) throw error;
    }, "Jogador removido.");

  const leave = () =>
    run("leave", async () => {
      await leaveRoom(room, userId);
      navigate("/");
    });

  const destroy = () => {
    if (!confirm("Apagar a sala, as gravações e o pack da nuvem? Isso não pode ser desfeito.")) return;
    void run("delete", async () => {
      await deleteRoom(room, takes);
      navigate("/");
    });
  };

  const unclaimed = room.manifest.characters.filter((c) => !claims.some((cl) => cl.character === c.name)).length;
  const recordableIds = room.manifest.clips.filter((c) => c.characters.some((ch) => claims.some((cl) => cl.character === ch))).map((c) => c.id);
  const recordableCount = recordableIds.length;
  const recordedCount = takes.filter((t) => recordableIds.includes(t.clip_id)).length;
  const waitingFor = members.filter((m) => !m.pack_ready);
  const allReady = waitingFor.length === 0;

  return (
    <div className="room-layout">
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Escolha seus personagens</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              {lobby
                ? "Clique para pegar ou soltar. Você pode dublar mais de um. Quem ficar sem dono usa a voz original."
                : "O elenco está travado. O dono pode reabrir a escolha."}
            </div>
          </div>
        </div>
        <div className="grid auto">
          {room.manifest.characters.map((c) => {
            const claim = claims.find((cl) => cl.character === c.name);
            const mine = claim?.user_id === userId;
            const owner = claim ? memberOf(claim.user_id) : null;
            const image = pack?.url(c.image);
            const loadingThis = busy === `char:${c.name}`;
            return (
              <button
                key={c.name}
                className={`char-card${mine ? " mine" : ""}${claim && !mine ? " taken" : ""}`}
                onClick={() => toggleCharacter(c.name)}
                disabled={!!busy || (!lobby && !isOwner) || (!!claim && !mine && !isOwner)}
              >
                <div className="char-img">{image ? <img src={image} alt="" /> : <UserRound size={28} />}</div>
                {claim && (
                  <div className="char-tag">
                    <span className="pill" style={{ color: "#fff" }}>
                      {mine ? <Check size={12} /> : null} {mine ? "Você" : owner?.profile?.display_name ?? "Ocupado"}
                    </span>
                  </div>
                )}
                <div className="char-body">
                  <div className="grow">
                    <strong className="truncate">{c.name}</strong>
                    <span>
                      {c.clips} {c.clips === 1 ? "fala" : "falas"}
                    </span>
                  </div>
                  {loadingThis ? <Spinner /> : claim ? <Avatar profile={owner?.profile} size="sm" /> : <span className="dim" style={{ fontSize: 12 }}>Livre</span>}
                  {claim && !mine && isOwner && lobby && <X size={14} className="dim" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="stack sticky" style={{ gap: 14 }}>
        <div className="card">
          <div className="card-head">
            <h3>Jogadores</h3>
            <span className="sub" style={{ marginLeft: "auto" }}>
              {members.length}/{room.max_players}
            </span>
          </div>
          <div className="card-body stack" style={{ gap: 12 }}>
            {members.map((m) => {
              const chars = claims.filter((c) => c.user_id === m.user_id).map((c) => c.character);
              return (
                <div key={m.user_id} className="row">
                  <Avatar profile={m.profile} online={online.has(m.user_id)} />
                  <div className="grow">
                    <div className="row" style={{ gap: 6 }}>
                      <strong className="truncate" style={{ fontSize: 13 }}>{m.profile?.display_name ?? "Jogador"}</strong>
                      {m.user_id === room.owner_id && <Crown size={13} className="gold" />}
                    </div>
                    <div className="muted truncate" style={{ fontSize: 12 }}>{chars.length ? chars.join(", ") : "Sem personagem"}</div>
                  </div>
                  <PackBadge status={packStatus[m.user_id]} ready={m.pack_ready} online={online.has(m.user_id)} />
                  {isOwner && m.user_id !== userId && (
                    <button className="btn ghost icon sm danger" title="Remover da sala" onClick={() => kick(m.user_id)} disabled={!!busy}>
                      <UserMinus size={15} />
                    </button>
                  )}
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, room.max_players - members.length) }).map((_, i) => (
              <div key={i} className="row dim" style={{ fontSize: 12.5 }}>
                <div className="avatar" style={{ borderStyle: "dashed", background: "transparent" }} />
                Vaga livre
              </div>
            ))}
          </div>
        </div>

        {isOwner ? (
          <div className="card">
            <div className="card-head">
              <Crown size={15} className="gold" />
              <h3>Controles do dono</h3>
            </div>
            <div className="card-body stack">
              {room.status === "lobby" && (
                <>
                  <button className="btn primary block" onClick={() => setStatus("recording", "Gravação liberada!")} disabled={!!busy || claims.length === 0 || !allReady}>
                    <Play size={15} /> {allReady ? "Iniciar gravação" : `Esperando ${waitingFor.length} ${waitingFor.length === 1 ? "pessoa" : "pessoas"}`}
                  </button>
                  {!allReady ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      Falta o pack ficar pronto para: {waitingFor.map((m) => m.profile?.display_name ?? "Jogador").join(", ")}.
                    </span>
                  ) : claims.length === 0 ? (
                    <span className="muted" style={{ fontSize: 12 }}>Alguém precisa pegar pelo menos um personagem.</span>
                  ) : unclaimed > 0 ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {unclaimed} {unclaimed === 1 ? "personagem vai" : "personagens vão"} usar a voz original.
                    </span>
                  ) : null}
                </>
              )}
              {room.status === "recording" && (
                <>
                  <div className="stack" style={{ gap: 6 }}>
                    <span style={{ fontSize: 13 }}>
                      <Flag size={13} /> {recordedCount}/{recordableCount} falas gravadas
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>O vídeo começa sozinho quando todo mundo terminar as falas.</span>
                  </div>
                  {takes.length === 0 && (
                    <button className="btn block" onClick={() => setStatus("lobby", "Elenco reaberto.")} disabled={!!busy}>
                      <RotateCcw size={15} /> Reabrir escolha de elenco
                    </button>
                  )}
                </>
              )}
              <button className="btn ghost danger block" onClick={destroy} disabled={!!busy}>
                <Trash2 size={15} /> Apagar sala
              </button>
            </div>
          </div>
        ) : (
          <button className="btn ghost danger" onClick={leave} disabled={!!busy}>
            <LogOut size={15} /> Sair da sala
          </button>
        )}
      </div>
    </div>
  );
}

function PackBadge({ status, ready, online }: { status?: { phase: string }; ready: boolean; online: boolean }) {
  if (ready) return <span className="pill ok" title="Pack pronto" style={{ height: 24, padding: "0 8px" }}><CircleCheck size={12} /> Pronto</span>;
  if (!online) return <span className="pill off" title="Desconectado" style={{ height: 24, padding: "0 8px" }}><WifiOff size={12} /></span>;
  const label = status?.phase === "downloading" ? "Baixando" : status?.phase === "extracting" ? "Extraindo" : status?.phase === "needs-file" ? "Sem arquivo" : status?.phase === "error" ? "Erro" : "Carregando";
  return <span className="pill warn" title="Preparando o pack" style={{ height: 24, padding: "0 8px" }}><Download size={12} /> {label}</span>;
}
