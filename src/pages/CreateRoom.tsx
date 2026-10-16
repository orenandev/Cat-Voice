import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cloud, FileArchive, Film, HardDrive, Link2, Mic2, Music, Upload, Users, X } from "lucide-react";
import { Topbar } from "../components/Layout";
import { Progress, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { useAuth } from "../lib/auth";
import { errorMessage, supabase } from "../lib/supabase";
import { ACCEPTED_ARCHIVES, buildManifest, createLoadedPack, extractArchive, findPackRoots, formatBytes, sha256, type PackFiles } from "../lib/pack";
import {
  CHUNK_SIZE,
  cachePack,
  downloadGameBanana,
  fetchGameBananaMod,
  parseGameBananaUrl,
  deleteCloudPack,
  uploadCloudPack,
  type GameBananaMod,
} from "../lib/packStore";
import { rememberLoadedPack } from "../lib/usePack";
import type { PackManifest, PackSource } from "../lib/types";

type Loaded = {
  blob: Blob;
  name: string;
  files: PackFiles;
  roots: string[];
  manifest: PackManifest;
  origin: "file" | "gamebanana";
  gb?: { mod: GameBananaMod; fileId: string };
};

type Busy = { label: string; value: number } | null;

const MAX_CLOUD = 64 * CHUNK_SIZE;

export default function CreateRoom() {
  const navigate = useNavigate();
  const toast = useToast();
  const { session } = useAuth();
  const [tab, setTab] = useState<"file" | "gamebanana">("file");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [gbInput, setGbInput] = useState("");
  const [gbMod, setGbMod] = useState<GameBananaMod | null>(null);
  const [name, setName] = useState("");
  const [players, setPlayers] = useState(4);
  const [distribution, setDistribution] = useState<"cloud" | "local">("cloud");
  const inputRef = useRef<HTMLInputElement>(null);

  const openArchive = async (blob: Blob, fileName: string, origin: Loaded["origin"], gb?: Loaded["gb"]) => {
    setError(null);
    setBusy({ label: "Extraindo arquivos do pack…", value: 0 });
    try {
      const files = await extractArchive(blob, fileName, (done, total) => setBusy({ label: `Extraindo arquivos (${done}/${total})…`, value: done / total }));
      const roots = findPackRoots(files);
      if (roots.length === 0) throw new Error("Não encontrei nenhum Dub Pack aqui. O arquivo precisa ter um vídeo chamado dub_video (.ogv).");
      const manifest = withTitle(await buildManifest(files, roots[0]), fileName, gb?.mod.name);
      if (!manifest.backing) throw new Error("Esse pack não tem trilha sonora (_backing_track). Escolha um Dub Pack que tenha a trilha.");
      setLoaded({ blob, name: fileName, files, roots, manifest, origin, gb });
      setName((n) => n || manifest.title.slice(0, 60));
      if (blob.size > MAX_CLOUD) setDistribution("local");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const chooseRoot = async (root: string) => {
    if (!loaded) return;
    try {
      const manifest = withTitle(await buildManifest(loaded.files, root), loaded.name, loaded.gb?.mod.name);
      setLoaded({ ...loaded, manifest });
      setName(manifest.title.slice(0, 60));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const lookupMod = async () => {
    const id = parseGameBananaUrl(gbInput);
    if (!id) return setError("Cole um link do GameBanana no formato gamebanana.com/mods/123456");
    setError(null);
    setGbMod(null);
    setBusy({ label: "Consultando o GameBanana…", value: 0 });
    try {
      const mod = await fetchGameBananaMod(id);
      if (mod.files.length === 0) throw new Error("Esse mod não tem arquivos ZIP, RAR ou 7z para baixar.");
      setGbMod(mod);
      if (mod.files.length === 1) await importGbFile(mod, mod.files[0].id, mod.files[0].size);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy((b) => (b?.label.startsWith("Consultando") ? null : b));
    }
  };

  const importGbFile = async (mod: GameBananaMod, fileId: string, size: number) => {
    setBusy({ label: "Baixando do GameBanana…", value: 0 });
    try {
      const { blob, name: fileName } = await downloadGameBanana(fileId, size, (loadedBytes, total) =>
        setBusy({ label: `Baixando do GameBanana (${formatBytes(loadedBytes)} de ${formatBytes(total)})…`, value: total ? loadedBytes / total : 0 }),
      );
      await openArchive(blob, fileName, "gamebanana", { mod, fileId });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const create = async () => {
    if (!loaded || !session) return;
    setError(null);
    try {
      let source: PackSource;
      let key: string;
      if (loaded.origin === "gamebanana" && loaded.gb) {
        source = "gamebanana";
        key = `gb-${loaded.gb.fileId}`;
      } else {
        setBusy({ label: "Calculando a assinatura do pack…", value: 0 });
        source = distribution;
        key = await sha256(loaded.blob);
      }
      setBusy({ label: "Criando a sala…", value: 0 });
      const chunks = source === "cloud" ? Math.ceil(loaded.blob.size / CHUNK_SIZE) : 0;
      const { data: room, error: insertError } = await supabase
        .from("rooms")
        .insert({
          name: name.trim() || loaded.manifest.title.slice(0, 60),
          max_players: players,
          owner_id: session.user.id,
          pack_source: source,
          pack_key: key,
          pack_name: loaded.name.slice(0, 200),
          pack_size: loaded.blob.size,
          pack_chunks: chunks,
          pack_url: loaded.gb?.mod.url ?? null,
          manifest: loaded.manifest,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const pack = createLoadedPack(loaded.manifest, loaded.files);
      rememberLoadedPack(key, pack);
      await cachePack(key, loaded.name, loaded.blob);

      if (source === "cloud") {
        try {
          const { data: available } = await supabase.rpc("cloud_pack_available", { p_key: key });
          if (!available) {
            await uploadCloudPack(key, loaded.blob, (sent, total) =>
              setBusy({ label: `Enviando pack para a nuvem (${formatBytes(sent)} de ${formatBytes(total)})…`, value: sent / total }),
            );
          }
          const { error: readyError } = await supabase.from("rooms").update({ pack_ready: true }).eq("id", room.id);
          if (readyError) throw readyError;
        } catch (err) {
          await deleteCloudPack(key, chunks).catch(() => undefined);
          await supabase.from("rooms").delete().eq("id", room.id);
          throw err;
        }
      }
      toast("Sala criada! Agora escolha seu personagem.");
      navigate(`/sala/${room.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const reset = () => {
    setLoaded(null);
    setGbMod(null);
    setName("");
    setError(null);
  };

  const m = loaded?.manifest;
  const tooBigForCloud = (loaded?.blob.size ?? 0) > MAX_CLOUD;

  return (
    <>
      <Topbar title="Nova sala" />
      <div className="content" style={{ maxWidth: 920 }}>
        {!loaded && (
          <div className="card">
            <div className="card-head">
              <div className="icon-tile sm">
                <FileArchive size={18} />
              </div>
              <div className="grow">
                <h3>1. Escolha o Dub Pack</h3>
                <div className="sub">Pack do The Choicer Voicer com dub_video.ogv e as falas com tempo de sincronia.</div>
              </div>
            </div>
            <div className="card-body stack">
              <div className="segmented" style={{ alignSelf: "flex-start" }}>
                <button className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>
                  <Upload size={14} /> Arquivo
                </button>
                <button className={tab === "gamebanana" ? "on" : ""} onClick={() => setTab("gamebanana")}>
                  <Link2 size={14} /> Link do GameBanana
                </button>
              </div>

              {tab === "file" ? (
                <div
                  className={`drop${over ? " over" : ""}`}
                  onClick={() => !busy && inputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f && !busy) void openArchive(f, f.name, "file");
                  }}
                >
                  <div className="icon-tile">
                    <Upload size={22} />
                  </div>
                  <strong>Arraste o pack aqui ou clique para escolher</strong>
                  <p>ZIP, RAR ou 7z · o arquivo é lido no seu navegador</p>
                  <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPTED_ARCHIVES}
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void openArchive(f, f.name, "file");
                    }}
                  />
                </div>
              ) : (
                <div className="stack">
                  <div className="row">
                    <input
                      className="input"
                      placeholder="https://gamebanana.com/mods/709786"
                      value={gbInput}
                      onChange={(e) => setGbInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !busy && lookupMod()}
                    />
                    <button className="btn primary" style={{ height: 42 }} onClick={lookupMod} disabled={!!busy || !gbInput.trim()}>
                      Importar
                    </button>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    Ninguém precisa baixar nada: cada pessoa da sala recebe o pack direto do GameBanana.
                  </div>
                  {gbMod && gbMod.files.length > 1 && !busy && (
                    <div className="stack">
                      <strong style={{ fontSize: 13 }}>{gbMod.name} — escolha o arquivo:</strong>
                      {gbMod.files.map((f) => (
                        <button key={f.id} className="choice" onClick={() => importGbFile(gbMod, f.id, f.size)}>
                          <FileArchive size={18} />
                          <div className="grow">
                            <strong>{f.name}</strong>
                            <span>{formatBytes(f.size)} {f.description && `· ${f.description}`}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {busy && (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row muted" style={{ fontSize: 13 }}>
                    <Spinner /> {busy.label}
                  </div>
                  <Progress value={busy.value} />
                </div>
              )}
              {error && <div className="notice error">{error}</div>}
            </div>
          </div>
        )}

        {loaded && m && (
          <div className="stack" style={{ gap: 18 }}>
            <div className="card">
              <div className="card-head">
                <div className="thumb">
                  {m.icon && loaded.files.get(m.root + m.icon) ? <PackIcon file={loaded.files.get(m.root + m.icon)!} /> : <Film size={20} />}
                </div>
                <div className="grow">
                  <h3 className="truncate">{m.title}</h3>
                  <div className="sub truncate">
                    {m.authors.length ? `por ${m.authors.join(", ")} · ` : ""}
                    {loaded.name} · {formatBytes(loaded.blob.size)}
                  </div>
                </div>
                <button className="btn ghost icon sm" onClick={reset} disabled={!!busy} aria-label="Trocar pack">
                  <X size={16} />
                </button>
              </div>
              <div className="card-body stack">
                {loaded.roots.length > 1 && (
                  <div className="field">
                    <label>Esse arquivo tem {loaded.roots.length} Dub Packs. Qual vocês vão dublar?</label>
                    <select className="input" value={m.root} onChange={(e) => chooseRoot(e.target.value)}>
                      {loaded.roots.map((r) => (
                        <option key={r} value={r}>
                          {r || "(raiz)"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid cols-3">
                  <div className="stat">
                    <strong>{m.characters.length}</strong>
                    <span>personagens</span>
                  </div>
                  <div className="stat">
                    <strong>{m.clips.length}</strong>
                    <span>falas para gravar</span>
                  </div>
                  <div className="stat">
                    <strong className="row" style={{ gap: 6 }}>
                      <Music size={16} /> {m.backing ? "Sim" : "Não"}
                    </strong>
                    <span>trilha de fundo</span>
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {m.characters.map((c) => (
                    <span key={c.name} className="pill">
                      <Mic2 size={12} /> {c.name} <span className="dim">{c.clips}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="icon-tile sm">
                  <Users size={18} />
                </div>
                <div className="grow">
                  <h3>2. Configure a sala</h3>
                  <div className="sub">Depois é só mandar o link ou o código para os amigos.</div>
                </div>
              </div>
              <div className="card-body stack" style={{ gap: 18 }}>
                <div className="field">
                  <label>Nome da sala</label>
                  <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Jogadores</label>
                  <div className="segmented" style={{ alignSelf: "flex-start" }}>
                    {[2, 3, 4, 5].map((n) => (
                      <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {loaded.origin === "file" && (
                  <div className="field">
                    <label>Como os amigos recebem o pack</label>
                    <div className="grid cols-2">
                      <button className={`choice${distribution === "cloud" ? " on" : ""}`} onClick={() => setDistribution("cloud")} disabled={tooBigForCloud}>
                        <span className="radio" />
                        <div>
                          <strong className="row" style={{ gap: 6 }}>
                            <Cloud size={15} /> Enviar para a nuvem
                          </strong>
                          <span>{tooBigForCloud ? "Arquivo grande demais para a nuvem." : "Recomendado. Os amigos baixam automaticamente ao entrar."}</span>
                        </div>
                      </button>
                      <button className={`choice${distribution === "local" ? " on" : ""}`} onClick={() => setDistribution("local")}>
                        <span className="radio" />
                        <div>
                          <strong className="row" style={{ gap: 6 }}>
                            <HardDrive size={15} /> Cada um usa o seu arquivo
                          </strong>
                          <span>Os amigos carregam o mesmo arquivo. A gente confere se é idêntico.</span>
                        </div>
                      </button>
                    </div>
                  </div>
                )}
                {loaded.origin === "gamebanana" && (
                  <div className="notice">
                    <Link2 size={16} />
                    <div>
                      <strong>Importado do GameBanana.</strong> Cada pessoa da sala recebe o pack direto de lá, sem ocupar a nuvem.
                    </div>
                  </div>
                )}
                {busy && (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row muted" style={{ fontSize: 13 }}>
                      <Spinner /> {busy.label}
                    </div>
                    <Progress value={busy.value} />
                  </div>
                )}
                {error && <div className="notice error">{error}</div>}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn primary lg" onClick={create} disabled={!!busy || !name.trim()}>
                    Criar sala
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function withTitle(manifest: PackManifest, fileName: string, modName?: string): PackManifest {
  if (modName && (/^\d+$/.test(manifest.title) || manifest.title === "Dub Pack")) return { ...manifest, title: modName.slice(0, 120) };
  if (/^\d+$/.test(manifest.title)) {
    const stem = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    return { ...manifest, title: (stem.charAt(0).toUpperCase() + stem.slice(1)).slice(0, 120) || manifest.title };
  }
  return manifest;
}

function PackIcon({ file }: { file: File }) {
  const [url] = useState(() => URL.createObjectURL(file));
  return <img src={url} alt="" />;
}
