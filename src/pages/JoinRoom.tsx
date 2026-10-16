import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DoorOpen, Users } from "lucide-react";
import { Topbar } from "../components/Layout";
import { Avatar, Spinner } from "../components/ui";
import { errorMessage, supabase } from "../lib/supabase";
import { STATUS_LABEL } from "./Home";

type Preview = {
  room_id: string;
  name: string;
  owner_name: string | null;
  owner_avatar: string | null;
  member_count: number;
  max_players: number;
  pack_name: string | null;
  status: string;
  is_member: boolean;
};

export default function JoinRoom() {
  const params = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState((params.code ?? "").toUpperCase());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (value: string) => {
    const clean = value.trim().toUpperCase();
    if (clean.length !== 6) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    const { data, error: rpcError } = await supabase.rpc("room_preview", { p_code: clean });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    const row = (data as Preview[] | null)?.[0];
    if (!row) return setError("Nenhuma sala com esse código.");
    if (row.is_member) return navigate(`/sala/${row.room_id}`, { replace: true });
    setPreview(row);
  };

  useEffect(() => {
    if (params.code) void lookup(params.code);
  }, [params.code]);

  const join = async () => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("join_room", { p_code: code.trim().toUpperCase() });
    setBusy(false);
    if (rpcError) return setError(errorMessage(rpcError));
    navigate(`/sala/${data}`);
  };

  const full = preview ? preview.member_count >= preview.max_players : false;

  return (
    <>
      <Topbar title="Entrar com código" />
      <div className="content" style={{ maxWidth: 520 }}>
        <div className="empty" style={{ paddingTop: 48, paddingBottom: 24 }}>
          <div className="icon-tile">
            <DoorOpen size={24} />
          </div>
          <h2>Entre na sala de um amigo</h2>
          <p>Digite o código de 6 letras que ele mandou ou abra o link de convite.</p>
        </div>
        <div className="stack">
          <input
            className="input code"
            maxLength={6}
            placeholder="ABC123"
            value={code}
            autoFocus
            onChange={(e) => {
              const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
              setCode(v);
              setPreview(null);
              if (v.length === 6) void lookup(v);
            }}
          />
          {busy && !preview && (
            <div className="row muted" style={{ justifyContent: "center" }}>
              <Spinner /> Procurando a sala…
            </div>
          )}
          {error && <div className="notice error">{error}</div>}
          {preview && (
            <div className="card pad stack">
              <div className="row">
                <Avatar profile={{ id: "", display_name: preview.owner_name, avatar_url: preview.owner_avatar }} size="lg" />
                <div className="grow">
                  <strong style={{ fontSize: 16 }}>{preview.name}</strong>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    de {preview.owner_name ?? "alguém"} · {STATUS_LABEL[preview.status]}
                  </div>
                </div>
                <span className="pill">
                  <Users size={13} /> {preview.member_count}/{preview.max_players}
                </span>
              </div>
              {preview.pack_name && <div className="muted truncate" style={{ fontSize: 12.5 }}>Pack: {preview.pack_name}</div>}
              <button className="btn primary lg" onClick={join} disabled={busy || full}>
                {busy ? <Spinner /> : <DoorOpen size={17} />} {full ? "Sala cheia" : "Entrar na sala"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
