import { Link } from "react-router-dom";
import { ArrowUpRight, BookOpen, Cloud, FileArchive, Link2, Package, Plus } from "lucide-react";
import { Topbar } from "../components/Layout";

const STRUCTURE = `meu_pack/
├── dub_video.ogv         vídeo da cena (obrigatório)
├── _backing_track.aac    trilha sem vozes (opcional)
├── _pack_info.ini        título e autores
├── 001_Peter_1.wav       fala
├── 001_Peter_1.txt       legenda, tempo e personagem
├── 001_Peter_1.jpg       imagem da fala
└── ...`;

const CLIP = `[data]

caption="Aqui homens aranhas"
image="001_Peter_1.jpg"
dub_timestamps=[14.027]
dub_characters=["Peter 1"]`;

export default function Packs() {
  return (
    <>
      <Topbar title="Packs" />
      <div className="content" style={{ maxWidth: 980 }}>
        <div className="empty" style={{ paddingTop: 32, paddingBottom: 28 }}>
          <div className="icon-tile">
            <Package size={24} />
          </div>
          <h2>Dub Packs do The Choicer Voicer</h2>
          <p>Use qualquer Dub Pack da comunidade. Baixe no GameBanana ou só cole o link na hora de criar a sala.</p>
          <div className="actions">
            <a className="btn primary lg" href="https://gamebanana.com/games/20674" target="_blank" rel="noreferrer">
              GameBanana <ArrowUpRight size={16} />
            </a>
            <a className="btn lg" href="https://thechoicervoicer.wiki/pt/packs/" target="_blank" rel="noreferrer">
              <BookOpen size={16} /> Packs em PT-BR
            </a>
          </div>
        </div>

        <div className="grid cols-3">
          <div className="card pad stack">
            <div className="icon-tile sm">
              <Link2 size={18} />
            </div>
            <strong>Link do GameBanana</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              Cole o link do mod e pronto: cada pessoa da sala recebe o pack direto de lá, sem limite de tamanho.
            </span>
          </div>
          <div className="card pad stack">
            <div className="icon-tile sm">
              <Cloud size={18} />
            </div>
            <strong>Arquivo na nuvem</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              Envie o ZIP, RAR ou 7z. Ele fica guardado enquanto a sala existir e os amigos baixam automaticamente.
            </span>
          </div>
          <div className="card pad stack">
            <div className="icon-tile sm">
              <FileArchive size={18} />
            </div>
            <strong>Cada um com o seu</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              Todo mundo carrega o mesmo arquivo. A gente confere a assinatura para garantir que é idêntico.
            </span>
          </div>
        </div>

        <div className="section-title">
          <h2>Formato que o Cat Voice entende</h2>
        </div>
        <div className="grid cols-2">
          <div className="card">
            <div className="card-head">
              <h3>Estrutura do pack</h3>
            </div>
            <div className="card-body">
              <div className="code-block">{STRUCTURE}</div>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h3>Arquivo de cada fala (.txt)</h3>
            </div>
            <div className="card-body stack">
              <div className="code-block">{CLIP}</div>
              <ul className="list-plain" style={{ fontSize: 13 }}>
                <li>
                  <span className="mono">dub_timestamps</span>: em que segundo do vídeo a fala entra.
                </li>
                <li>
                  <span className="mono">dub_characters</span>: vira o personagem que cada um escolhe.
                </li>
                <li>Personagem sem dono usa a voz original na montagem.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "center", marginTop: 32 }}>
          <Link to="/nova-sala" className="btn primary lg">
            <Plus size={17} /> Criar sala com um pack
          </Link>
        </div>
      </div>
    </>
  );
}
