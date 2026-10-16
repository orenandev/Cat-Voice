import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Check, Copy, Film, HardDrive, Link2, Lock, LogOut, Mic, RotateCw, Users } from "lucide-react";
import { Topbar } from "../components/Layout";
import { Empty, Progress, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { Cast } from "../components/room/Cast";
import { Recorder } from "../components/room/Recorder";
import { Result } from "../components/room/Result";
import { useAuth } from "../lib/auth";
import { useRoom } from "../lib/useRoom";
import { usePack, type PackState } from "../lib/usePack";
import { ACCEPTED_ARCHIVES, formatBytes } from "../lib/pack";
import type { Room } from "../lib/types";
import { STATUS_LABEL } from "./Home";
import { deleteRoom, leaveRoom } from "../lib/roomActions";
import { errorMessage, supabase } from "../lib/supabase";
import { safeGameBananaUrl } from "../lib/packStore";
import { prefetchTakes } from "../lib/takeStore";

type Tab = "cast" | "record";

export default function RoomRoute() {
  const { id } = useParams();
  return <RoomPage key={id} id={id} />;
}

function RoomPage({ id }: { id: string | undefined }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const data = useRoom(id, userId);
  const { room, members, claims, takes, loading, error } = data;
  const pack = usePack(room);
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { announce } = data;
  const phase = pack.state.phase;
  useEffect(() => {
    announce({ phase });
  }, [announce, phase]);

  const markedReady = members.find((m) => m.user_id === userId)?.pack_ready;
  useEffect(() => {
    if (phase !== "ready" || markedReady !== false || !room || !userId) return;
    void supabase
      .from("room_members")
      .update({ pack_ready: true })
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .then(({ error }) => !error && data.notify());
  }, [phase, markedReady, room?.id, userId]);

  const status = room?.status;
  useEffect(() => {
    if (status && status !== "lobby") prefetchTakes(takes);
  }, [status, takes]);

  const myCharacters = useMemo(() => claims.filter((c) => c.user_id === userId).map((c) => c.character), [claims, userId]);
  const myClips = useMemo(
    () => (room ? room.manifest.clips.filter((clip) => clip.characters.some((c) => myCharacters.includes(c))) : []),
    [room, myCharacters],
  );
  const myDone = myClips.filter((c) => takes.some((t) => t.clip_id === c.id)).length;
  const recordable = room ? room.manifest.clips.filter((clip) => clip.characters.some((c) => claims.some((cl) => cl.character === c))) : [];
  const recordedTotal = takes.filter((t) => recordable.some((c) => c.id === t.clip_id)).length;

  const recordingOpen = room?.status === "recording";
  const activeTab: Tab = !recordingOpen ? "cast" : tab ?? (myClips.length ? "record" : "cast");

  if (loading)
    return (
      <>
        <Topbar title="Sala" />
        <div className="empty">
          <Spinner size={20} />
        </div>
      </>
    );

  if (error || !room)
    return (
      <>
        <Topbar title="Sala" />
        <Empty icon={<AlertTriangle size={22} />} title="Sala indisponível" text={error ?? "Essa sala não existe mais."}>
          <button className="btn primary" onClick={() => navigate("/")}>
            Voltar ao início
          </button>
        </Empty>
      </>
    );

  const isOwner = room.owner_id === userId;
  const exit = async (ask = true) => {
    if (ask && !confirm(isOwner ? "Encerrar a sala? Ela será apagada com as gravações para todo mundo." : "Sair da sala?")) return;
    setLeaving(true);
    try {
      if (isOwner) await deleteRoom(room, takes);
      else await leaveRoom(room, userId!);
      data.notify();
      navigate("/");
    } catch (err) {
      toast(errorMessage(err), true);
      setLeaving(false);
    }
  };

  const invite = `${window.location.origin}/entrar/${room.code}`;
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copiado!`);
    } catch {
      toast(text);
    }
  };

  return (
    <>
      <Topbar title={room.name}>
        <span className={`pill${room.status === "recording" ? " rec" : room.status === "finished" ? " ok" : " warn"}`}>
          <span className="dot" /> {STATUS_LABEL[room.status]}
        </span>
        <div className="spacer" />
        <button className="pill mono button" onClick={() => copy(room.code, "Código")} title="Copiar código">
          {room.code} <Copy size={12} />
        </button>
        {room.status !== "finished" && (
          <button className="btn sm hide-sm" onClick={() => copy(invite, "Link de convite")}>
            <Link2 size={14} /> Convidar
          </button>
        )}
        <button className="btn sm danger" onClick={() => exit()} disabled={leaving}>
          {leaving ? <Spinner /> : <LogOut size={14} />} <span className="hide-sm">{isOwner ? "Encerrar sala" : "Sair da sala"}</span>
        </button>
      </Topbar>
      <div className="content wide">
        <PackBanner state={pack.state} room={room} onRetry={pack.retry} onFile={pack.provideFile} />
        {room.status === "finished" ? (
          pack.state.phase === "ready" ? (
            <Result room={room} pack={pack.state.pack} data={data} userId={userId!} onExit={() => exit()} leaving={leaving} />
          ) : (
            <PackPending state={pack.state} />
          )
        ) : (
          <>
            <div className="tabs">
              <button className={activeTab === "cast" ? "on" : ""} onClick={() => setTab("cast")}>
                <Users size={16} /> Elenco <span className="badge">{members.length}/{room.max_players}</span>
              </button>
              <button
                className={activeTab === "record" ? "on" : ""}
                onClick={() => setTab("record")}
                disabled={!recordingOpen}
                title={recordingOpen ? undefined : "Libera quando o dono iniciar a gravação"}
                style={recordingOpen ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
              >
                {recordingOpen ? <Mic size={16} /> : <Lock size={16} />} Gravação <span className="badge">{myDone}/{myClips.length}</span>
              </button>
              {room.status === "recording" && (
                <span className="muted hide-sm" style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12.5 }}>
                  Sala: {recordedTotal}/{recordable.length} falas gravadas
                </span>
              )}
            </div>
            {activeTab === "cast" && (
              <Cast data={data} userId={userId!} packState={pack.state} onStartRecording={() => setTab("record")} />
            )}
            {activeTab === "record" &&
              (pack.state.phase === "ready" ? (
                <Recorder room={room} pack={pack.state.pack} clips={myClips} takes={takes} userId={userId!} notify={data.notify} refresh={data.refresh} goToCast={() => setTab("cast")} />
              ) : (
                <PackPending state={pack.state} />
              ))}
          </>
        )}
      </div>
    </>
  );
}

function PackPending({ state }: { state: PackState }) {
  return (
    <Empty
      icon={state.phase === "error" ? <AlertTriangle size={22} /> : <Film size={22} />}
      title={state.phase === "error" ? "O pack não carregou" : "Preparando o pack"}
      text={state.phase === "error" ? state.message : "Assim que o pack terminar de carregar, essa parte libera."}
    />
  );
}

function PackBanner({ state, room, onRetry, onFile }: { state: PackState; room: Room; onRetry: () => void; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const modPage = safeGameBananaUrl(room.pack_url);
  if (state.phase === "ready" || state.phase === "idle") return null;
  return (
    <div className={`notice${state.phase === "error" ? " error" : ""}`} style={{ marginBottom: 20, alignItems: "center" }}>
      {state.phase === "downloading" || state.phase === "extracting" || state.phase === "waiting" ? <Spinner /> : state.phase === "error" ? <AlertTriangle size={18} /> : <HardDrive size={18} />}
      <div className="grow stack" style={{ gap: 8 }}>
        {state.phase === "downloading" && (
          <>
            <span>
              <strong>Baixando o pack</strong> · {formatBytes(state.loaded)} de {formatBytes(state.total)}
              {room.pack_source === "gamebanana" ? " (direto do GameBanana)" : ""}
            </span>
            <Progress value={state.total ? state.loaded / state.total : 0} thin />
          </>
        )}
        {state.phase === "extracting" && (
          <span>
            <strong>Extraindo o pack…</strong> leva só alguns segundos.
          </span>
        )}
        {state.phase === "waiting" && <span>{state.message}</span>}
        {state.phase === "needs-file" && (
          <span>
            <strong>Carregue o pack para jogar.</strong> O dono escolheu que cada um usa o próprio arquivo:{" "}
            <span className="mono">{room.pack_name}</span> ({formatBytes(room.pack_size)}).
            {modPage && (
              <>
                {" "}
                <a href={modPage} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
                  Baixar no GameBanana
                </a>
              </>
            )}
          </span>
        )}
        {state.phase === "error" && <span>{state.message}</span>}
      </div>
      {state.phase === "needs-file" && (
        <>
          <button className="btn primary sm" onClick={() => input.current?.click()}>
            Escolher arquivo
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept={ACCEPTED_ARCHIVES}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onFile(f);
            }}
          />
        </>
      )}
      {state.phase === "error" && (
        <button className="btn sm" onClick={onRetry}>
          <RotateCw size={14} /> Tentar de novo
        </button>
      )}
      {state.phase === "waiting" && (
        <button className="btn ghost sm" onClick={onRetry}>
          <Check size={14} /> Verificar
        </button>
      )}
    </div>
  );
}
