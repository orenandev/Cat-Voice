<div align="center">

<img src="public/logo.png" alt="Cat Voice" width="160" />

# 🐱 Cat Voice

**Dublagem em grupo, direto no navegador. Miau! 🎙️**

Junte de 2 a 5 amigos, escolham os personagens, gravem as falas e assistam juntos a cena dublada.

![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%7C%20DB%20%7C%20Realtime-3ECF8E?logo=supabase&logoColor=white)

```
  /\_/\      /\_/\      /\_/\
 ( o.o )    ( ^.^ )    ( -.- )
  > 🎤 <     > 🎧 <     > 🎬 <
 grava      escuta     assiste
```

</div>

---

## 😺 O que é

O **Cat Voice** é um estúdio de dublagem multiplayer feito para os **Dub Packs do [The Choicer Voicer](https://thechoicervoicer.wiki/pt/packs/)**. Uma pessoa cria a sala com um pack, manda o link ou o código, cada um escolhe seus personagens, grava as falas no tempo certo e, no final, todo mundo assiste (e baixa) a cena dublada.

> 🐾 Sim, o app mia quando você abre. É uma escolha de design. Não há como voltar atrás.

## 🐈 Funcionalidades

- 😸 **Sem cadastro**: é só digitar um apelido (sessão anônima do Supabase)
- 👥 **2 a 5 jogadores** por sala, tudo sincronizado em **tempo real**
- 📦 Packs em **ZIP, RAR ou 7z** (o mesmo formato do GameBanana), lidos direto no navegador
- 🚚 3 formas de distribuir o pack:
  - 🔗 **Link do GameBanana**: cada um baixa direto de lá, via Edge Function
  - ☁️ **Nuvem**: upload em partes de 45 MB
  - 💾 **Cada um com o seu arquivo**: conferido por SHA-256
- 🎞️ Vídeo `.ogv` tocado em qualquer navegador com **ogv.js**
- 🎚️ Resultado com volume separado de **vozes, trilha e geral**, comparação com o original
- 📼 Download em **MP4** (ffmpeg.wasm) e **WAV**

## 🧶 Stack

| Camada | Tecnologia |
| --- | --- |
| Front-end | Vite + React + TypeScript, ícones [lucide-react](https://lucide.dev) |
| Back-end | [Supabase](https://supabase.com): Auth anônima, Postgres com RLS, Storage, Realtime e Edge Function |
| Mídia | [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) (ZIP/RAR/7z), [ogv.js](https://github.com/brion/ogv.js) (Theora/Vorbis), [ffmpeg.wasm](https://ffmpegwasm.netlify.app) (MP4) |
| Deploy | [Vercel](https://vercel.com) |

---

## 🐾 Rodando o seu próprio Cat Voice

### 1. Pré-requisitos

- [Node.js](https://nodejs.org) 18 ou mais novo
- Uma conta gratuita no [Supabase](https://supabase.com)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (para aplicar o banco e publicar a Edge Function)

### 2. Clone e instale

```bash
git clone https://github.com/orenandev/Cat-Voice.git
cd Cat-Voice
npm install
```

### 3. Crie o projeto no Supabase

1. Crie um projeto novo no [painel do Supabase](https://supabase.com/dashboard).
2. Ative o login anônimo: **Authentication → Sign In / Providers → Allow anonymous sign-ins**.

### 4. Aplique o banco de dados

Com a CLI (o `project-ref` está na URL do painel):

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

> 🐱 Sem CLI? Cole cada arquivo de `supabase/migrations/` no **SQL Editor**, **em ordem de data**.

Isso cria as tabelas `profiles`, `rooms`, `room_members`, `character_claims` e `takes` (todas com RLS), os buckets privados `packs` e `takes` e liga o Realtime.

### 5. Publique a Edge Function

A função `gamebanana` faz proxy dos downloads do GameBanana (com limite de taxa por usuário):

```bash
npx supabase functions deploy gamebanana
```

As variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY` já são injetadas automaticamente pelo Supabase, não precisa configurar nada.

### 6. Configure o `.env.local`

```bash
cp .env.example .env.local
```

Preencha com os dados de **Project Settings → API**:

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_publica
```

> 🙀 Use só a chave **pública** (publishable / anon). **Nunca** coloque a `service_role` / secret key no front-end.

### 7. Rode!

```bash
npm run dev
```

Abra `http://localhost:5173` e prepare-se para o miau. 🐈‍⬛

---

## 🚀 Deploy na Vercel

1. Importe o repositório na Vercel (framework **Vite**, build `npm run build`, saída `dist`).
2. Em **Settings → Environment Variables**, adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Deploy. O `vercel.json` já cuida das rotas do SPA e dos headers de segurança.

## 📁 Estrutura

```
src/
├── pages/         telas (login, criar sala, entrar, sala, packs)
├── components/    layout, palco de vídeo, gravador, elenco, resultado
└── lib/           Supabase, leitura de packs, áudio, exportação de vídeo, miau 🐱
supabase/
├── migrations/    schema, RLS, buckets e RPCs
└── functions/     gamebanana (proxy de download)
```

## 📦 Formato do pack

```
meu_pack/
├── dub_video.ogv         vídeo da cena (obrigatório)
├── _backing_track.aac    trilha sem vozes (opcional)
├── _pack_info.ini        título e autores
├── 001_Peter_1.wav       fala
├── 001_Peter_1.txt       legenda, tempo e personagem
├── 001_Peter_1.jpg       imagem da fala
└── ...
```

Os packs são da comunidade do **The Choicer Voicer** e podem ser encontrados no [GameBanana](https://gamebanana.com/games/20674).

---

<div align="center">

```
   |\__/,|   (`\
 _.|o o  |_   ) )
-(((---(((--------
```

Feito com 🧡 e muitos miaus por **[Renan](https://github.com/orenandev)**

</div>
