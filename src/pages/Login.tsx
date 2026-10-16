import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowRight, Headphones, Mic, Users } from "lucide-react";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/supabase";
import { BrandMark, Spinner } from "../components/ui";

const NAME_KEY = "cvs:last-name";

function lastName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    return;
  }
}

export default function Login() {
  const { session, enter } = useAuth();
  const location = useLocation();
  const [name, setName] = useState(lastName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const invited = from.startsWith("/entrar/");

  if (session) return <Navigate to={from} replace />;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await enter(name);
      rememberName(name.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void go();
        }}
      >
        <BrandMark size={56} />
        <h1>Cat Voice</h1>
        <p>{invited ? "Você foi convidado para uma sala. Escolha um apelido para entrar." : "Crie uma sala, escolha seu personagem e dublem juntos as cenas dos Dub Packs."}</p>
        <div className="row" style={{ gap: 18, margin: "10px 0 14px", color: "var(--muted)", fontSize: 12.5 }}>
          <span className="row" style={{ gap: 6 }}>
            <Users size={14} /> 2 a 5 pessoas
          </span>
          <span className="row" style={{ gap: 6 }}>
            <Mic size={14} /> Grave suas falas
          </span>
          <span className="row" style={{ gap: 6 }}>
            <Headphones size={14} /> Assista junto
          </span>
        </div>
        <input
          className="input"
          style={{ height: 48, textAlign: "center", fontSize: 16 }}
          placeholder="Seu apelido"
          maxLength={24}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn primary lg" type="submit" disabled={busy || !name.trim()}>
          {busy ? <Spinner /> : <ArrowRight size={17} />} {invited ? "Entrar na sala" : "Começar"}
        </button>
        {error && <div className="notice error" style={{ width: "100%" }}>{error}</div>}
        <p className="dim" style={{ fontSize: 12 }}>Sem cadastro. Use fones de ouvido na hora de gravar.</p>
      </form>
    </div>
  );
}
