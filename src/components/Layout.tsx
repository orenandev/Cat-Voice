import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Check, DoorOpen, Home, LogOut, Menu, Package, Pencil, Plus, Radio } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { Avatar, BrandMark } from "./ui";

type RecentRoom = { id: string; name: string; code: string; status: string };

const MenuContext = createContext<() => void>(() => undefined);

export function Layout() {
  const { profile, signOut, session, rename } = useAuth();
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<RecentRoom[]>([]);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("room_members")
      .select("joined_at, room:rooms(id, name, code, status)")
      .eq("user_id", session.user.id)
      .order("joined_at", { ascending: false })
      .limit(6)
      .then(({ data }) => setRooms(((data ?? []) as unknown as { room: RecentRoom | null }[]).map((r) => r.room).filter((r): r is RecentRoom => !!r)));
  }, [session, location.pathname]);

  return (
    <MenuContext.Provider value={() => setOpen((o) => !o)}>
      <div className="app">
        <aside className={`sidebar${open ? " open" : ""}`}>
          <div className="brand">
            <BrandMark />
            <div className="brand-text">
              <strong>Cat Voice</strong>
            </div>
          </div>
          <NavLink to="/" end className="nav-link">
            <Home size={17} /> Início
          </NavLink>
          <NavLink to="/nova-sala" className="nav-link">
            <Plus size={17} /> Nova sala
          </NavLink>
          <NavLink to="/entrar" className="nav-link">
            <DoorOpen size={17} /> Entrar com código
          </NavLink>
          <NavLink to="/packs" className="nav-link">
            <Package size={17} /> Packs
          </NavLink>
          {rooms.length > 0 && <div className="nav-label">Suas salas</div>}
          {rooms.map((r) => (
            <NavLink key={r.id} to={`/sala/${r.id}`} className="nav-link">
              <Radio size={15} />
              <span className="truncate">{r.name}</span>
              <span className="count">{r.code}</span>
            </NavLink>
          ))}
          <div className="sidebar-footer">
            <Avatar profile={profile} />
            {editing !== null ? (
              <form
                className="who row"
                style={{ gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename(editing).finally(() => setEditing(null));
                }}
              >
                <input className="input" style={{ height: 30, padding: "0 8px" }} maxLength={24} autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} />
                <button className="btn ghost icon sm" type="submit" aria-label="Salvar apelido">
                  <Check size={15} />
                </button>
              </form>
            ) : (
              <>
                <div className="who">
                  <strong>{profile?.display_name ?? "Jogador"}</strong>
                  <span>Convidado</span>
                </div>
                <button className="btn ghost icon sm" onClick={() => setEditing(profile?.display_name ?? "")} title="Trocar apelido" aria-label="Trocar apelido">
                  <Pencil size={15} />
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => confirm("Sair? Sem login, você perde o acesso às salas atuais neste navegador.") && signOut()}
                  title="Sair"
                  aria-label="Sair"
                >
                  <LogOut size={16} />
                </button>
              </>
            )}
          </div>
        </aside>
        <div className={`scrim${open ? " open" : ""}`} onClick={() => setOpen(false)} />
        <main className="main">
          <Outlet />
        </main>
      </div>
    </MenuContext.Provider>
  );
}

export function Topbar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const toggle = useContext(MenuContext);
  return (
    <header className="topbar">
      <button className="btn ghost icon sm menu-btn" onClick={toggle} aria-label="Menu">
        <Menu size={18} />
      </button>
      <h1 className="truncate">{title}</h1>
      {children}
    </header>
  );
}
