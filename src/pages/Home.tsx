import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, DoorOpen, Headphones, Plus, Users } from "lucide-react";
import { Topbar } from "../components/Layout";
import { Empty, Spinner } from "../components/ui";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Room } from "../lib/types";

type RoomRow = Pick<Room, "id" | "name" | "code" | "status" | "max_players" | "pack_name" | "manifest" | "owner_id"> & { room_members: { count: number }[] };

export const STATUS_LABEL: Record<string, string> = { lobby: "Escolhendo elenco", recording: "Gravando", finished: "Assistindo" };

export default function Home() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);

  useEffect(() => {
    supabase
      .from("rooms")
      .select("id, name, code, status, max_players, pack_name, owner_id, manifest->title, room_members(count)")
      .order("updated_at", { ascending: false })
      .limit(30)
      .then(({ data }) => setRooms((data as unknown as RoomRow[]) ?? []));
  }, []);

  return (
    <>
      <Topbar title="Início">
        <span className="pill">
          <span className="dot" /> Fora de sala
        </span>
        <div className="spacer" />
        <Link to="/entrar" className="btn sm hide-sm">
          <DoorOpen size={15} /> Entrar com código
        </Link>
        <Link to="/nova-sala" className="btn primary sm">
          <Plus size={15} /> Nova sala
        </Link>
      </Topbar>
      <div className="content">
        {rooms === null ? (
          <div className="empty">
            <Spinner size={20} />
          </div>
        ) : rooms.length === 0 ? (
          <Empty
            icon={<Headphones size={24} />}
            title="Entre em uma sala"
            text="Crie uma sala com um Dub Pack ou entre na sala de um amigo usando o código de convite."
            hint="Os packs vêm do GameBanana: ZIP, RAR ou 7z."
          >
            <button className="btn primary lg" onClick={() => navigate("/nova-sala")}>
              <Plus size={17} /> Criar sala
            </button>
            <button className="btn lg" onClick={() => navigate("/entrar")}>
              <DoorOpen size={17} /> Entrar com código
            </button>
          </Empty>
        ) : (
          <>
            <div className="section-title" style={{ marginTop: 0 }}>
              <h2>Suas salas</h2>
              <span className="muted">{rooms.length}</span>
            </div>
            <div className="grid cols-2">
              {rooms.map((r) => {
                const title = (r as unknown as { title?: string }).title ?? r.pack_name;
                const count = r.room_members?.[0]?.count ?? 0;
                return (
                  <Link key={r.id} to={`/sala/${r.id}`} className="card room-card">
                    <div className="thumb">
                      <Headphones size={20} />
                    </div>
                    <div className="grow">
                      <div className="row" style={{ gap: 8 }}>
                        <strong className="truncate">{r.name}</strong>
                        {r.owner_id === session?.user.id && <span className="dim" style={{ fontSize: 11.5 }}>dono</span>}
                      </div>
                      <div className="muted truncate" style={{ fontSize: 12.5 }}>{title}</div>
                      <div className="row" style={{ gap: 8, marginTop: 6 }}>
                        <span className={`pill${r.status === "recording" ? " rec" : r.status === "finished" ? " ok" : " warn"}`} style={{ height: 22, fontSize: 11.5 }}>
                          <span className="dot" /> {STATUS_LABEL[r.status]}
                        </span>
                        <span className="muted row" style={{ gap: 4, fontSize: 12 }}>
                          <Users size={13} /> {count}/{r.max_players}
                        </span>
                        <span className="mono dim" style={{ fontSize: 12 }}>{r.code}</span>
                      </div>
                    </div>
                    <ChevronRight size={18} className="dim" />
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
