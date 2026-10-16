import { useEffect, useRef, useState, type ReactNode } from "react";
import { createVideoElement } from "../lib/ogv";
import { isMediaNativelyPlayable } from "../lib/pack";
import { Spinner } from "./ui";

export type StageVideo = HTMLVideoElement;

export function VideoStage({
  src,
  path,
  onReady,
  children,
}: {
  src: string | undefined;
  path: string;
  onReady: (video: StageVideo | null) => void;
  children?: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    if (!src || !surfaceRef.current) return;
    let disposed = false;
    let element: StageVideo | null = null;
    setState("loading");
    createVideoElement(src, isMediaNativelyPlayable(path))
      .then((video) => {
        if (disposed) return;
        element = video;
        video.style.width = "100%";
        video.style.height = "100%";
        const markReady = () => {
          if (disposed) return;
          setState("ready");
          readyRef.current(video);
        };
        video.addEventListener("loadedmetadata", markReady, { once: true });
        video.addEventListener("error", () => !disposed && setState("error"), { once: true });
        surfaceRef.current?.appendChild(video);
        video.load?.();
      })
      .catch(() => !disposed && setState("error"));
    return () => {
      disposed = true;
      readyRef.current(null);
      if (element) {
        element.pause();
        element.removeAttribute("src");
        (element as unknown as { stop?: () => void }).stop?.();
        element.remove();
      }
    };
  }, [src, path]);

  return (
    <div className="stage">
      <div className="surface" ref={surfaceRef} />
      {state === "loading" && (
        <div className="stage-loading">
          <div className="row">
            <Spinner /> Carregando vídeo…
          </div>
        </div>
      )}
      {state === "error" && (
        <div className="stage-loading">
          <span>Não foi possível reproduzir o vídeo neste navegador.</span>
        </div>
      )}
      <div className="overlay">{children}</div>
    </div>
  );
}

export function waitFor(video: StageVideo, event: string, timeout = 4000) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      resolve();
    };
    const timer = setTimeout(done, timeout);
    video.addEventListener(event, done);
  });
}

export async function seekTo(video: StageVideo, time: number) {
  const target = Math.max(0, time);
  if (Math.abs(video.currentTime - target) < 0.02) return;
  const wait = waitFor(video, "seeked", 6000);
  video.currentTime = target;
  await wait;
}

export function playMedia(media: HTMLMediaElement) {
  return Promise.resolve(media.play() as Promise<void> | undefined).catch(() => undefined);
}
