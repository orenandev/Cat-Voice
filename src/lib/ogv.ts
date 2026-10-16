import { audioContext } from "./audio";

type OGVGlobals = {
  OGVPlayer: new (options?: Record<string, unknown>) => HTMLVideoElement;
  OGVLoader: { base: string };
};

let loading: Promise<OGVGlobals> | null = null;

export function loadOgv() {
  if (loading) return loading;
  loading = new Promise<OGVGlobals>((resolve, reject) => {
    const w = window as unknown as Partial<OGVGlobals>;
    if (w.OGVPlayer && w.OGVLoader) return resolve(w as OGVGlobals);
    const script = document.createElement("script");
    script.src = "/vendor/ogv/ogv.js";
    script.async = true;
    script.onload = () => {
      const g = window as unknown as OGVGlobals;
      g.OGVLoader.base = "/vendor/ogv";
      resolve(g);
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Não foi possível carregar o player de vídeo OGV"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function createVideoElement(src: string, native: boolean) {
  if (native) {
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.src = src;
    return video;
  }
  const { OGVPlayer } = await loadOgv();
  const player = new OGVPlayer({ debug: false, audioContext: audioContext() });
  player.src = src;
  return player;
}
