import { useCallback, useEffect, useRef, useState } from "react";

const DEVICE_KEY = "cvs:mic";

function savedDevice() {
  try {
    return localStorage.getItem(DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveDevice(id: string) {
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    return;
  }
}

export function useMic() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(savedDevice);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async (id = deviceId) => {
    setError(null);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const next = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: id ? { exact: id } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = next;
      setStream(next);
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch (err) {
      const name = (err as DOMException).name;
      setError(name === "NotAllowedError" ? "Permita o acesso ao microfone no navegador para gravar." : "Não encontrei um microfone disponível.");
    }
  }, [deviceId]);

  const choose = useCallback(
    (id: string) => {
      setDeviceId(id);
      saveDevice(id);
      void start(id);
    },
    [start],
  );

  useEffect(() => {
    if (!stream) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      setLevel((prev) => Math.max(peak, prev * 0.85));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return { stream, devices, deviceId, level, error, start, choose };
}
