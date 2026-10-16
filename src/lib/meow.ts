const PLAYED_KEY = "cvs:meow";

function alreadyPlayed() {
  try {
    return sessionStorage.getItem(PLAYED_KEY) === "1";
  } catch {
    return false;
  }
}

function markPlayed() {
  try {
    sessionStorage.setItem(PLAYED_KEY, "1");
  } catch {
    return;
  }
}

export function playMeow(ctx: AudioContext) {
  const t = ctx.currentTime + 0.02;
  const length = 0.75;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(1, t + 0.06);
  out.gain.setValueAtTime(1, t + length * 0.55);
  out.gain.exponentialRampToValueAtTime(0.0001, t + length);
  out.connect(ctx.destination);

  const voice = ctx.createOscillator();
  voice.type = "sawtooth";
  voice.frequency.setValueAtTime(520, t);
  voice.frequency.linearRampToValueAtTime(820, t + length * 0.35);
  voice.frequency.linearRampToValueAtTime(700, t + length * 0.6);
  voice.frequency.exponentialRampToValueAtTime(380, t + length);

  const vibrato = ctx.createOscillator();
  const vibratoDepth = ctx.createGain();
  vibrato.frequency.value = 6;
  vibratoDepth.gain.value = 9;
  vibrato.connect(vibratoDepth).connect(voice.frequency);

  const formants: [number, number, number][] = [
    [900, 1500, 750],
    [2400, 2900, 1100],
  ];
  for (const [start, mid, end] of formants) {
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 6;
    band.frequency.setValueAtTime(start, t);
    band.frequency.linearRampToValueAtTime(mid, t + length * 0.4);
    band.frequency.linearRampToValueAtTime(end, t + length);
    voice.connect(band).connect(out);
  }

  voice.start(t);
  vibrato.start(t);
  voice.stop(t + length + 0.05);
  vibrato.stop(t + length + 0.05);
}

export function meowOnOpen() {
  if (alreadyPlayed() || typeof AudioContext === "undefined") return;
  const ctx = new AudioContext();
  const fire = () => {
    if (alreadyPlayed()) return;
    markPlayed();
    playMeow(ctx);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  const unlock = () => void ctx.resume().then(fire);
  if (ctx.state === "running") fire();
  else {
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    void ctx.resume().then(() => ctx.state === "running" && fire()).catch(() => undefined);
  }
}
