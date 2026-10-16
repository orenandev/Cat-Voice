import { useState, type ReactNode } from "react";
import { AudioWaveform, Loader2 } from "lucide-react";
import type { Profile } from "../lib/types";

export function BrandMark({ size = 34 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="brand-mark" style={{ width: size, height: size }}>
      {failed ? <AudioWaveform size={size * 0.55} strokeWidth={2.4} /> : <img src="/logo.png" alt="Cat Voice" onError={() => setFailed(true)} />}
    </div>
  );
}

export function Avatar({ profile, size, online }: { profile: Profile | null | undefined; size?: "sm" | "lg"; online?: boolean }) {
  const name = profile?.display_name ?? "?";
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const avatar = (
    <div className={`avatar${size ? ` ${size}` : ""}`} title={name}>
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials}
    </div>
  );
  if (online === undefined) return avatar;
  return (
    <span className="avatar-wrap">
      {avatar}
      <span className={`presence${online ? " on" : ""}`} />
    </span>
  );
}

export function Empty({ icon, title, text, children, hint }: { icon: ReactNode; title: string; text?: ReactNode; children?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon-tile">{icon}</div>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {children && <div className="actions">{children}</div>}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Progress({ value, thin }: { value: number; thin?: boolean }) {
  return (
    <div className={`progress${thin ? " thin" : ""}`}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />;
}

export function GoogleIcon() {
  return (
    <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.7 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.7 14.55 2.75 12 2.75 6.9 2.75 2.75 6.9 2.75 12s4.15 9.25 9.25 9.25c5.34 0 8.88-3.75 8.88-9.04 0-.6-.07-1.07-.15-1.53Z" />
    </svg>
  );
}

export function DiscordIcon() {
  return (
    <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M19.27 5.33A16.5 16.5 0 0 0 15.2 4.06a11.4 11.4 0 0 0-.52 1.07 15.3 15.3 0 0 0-4.56 0 11 11 0 0 0-.53-1.07c-1.43.25-2.8.68-4.07 1.27C2.95 9.2 2.25 12.98 2.6 16.7a16.6 16.6 0 0 0 5 2.53c.4-.55.76-1.14 1.07-1.75-.59-.22-1.15-.5-1.68-.81l.41-.32a11.8 11.8 0 0 0 10.2 0l.41.32c-.53.32-1.1.59-1.69.81.31.61.67 1.2 1.07 1.75a16.5 16.5 0 0 0 5-2.53c.42-4.32-.7-8.07-2.93-11.37ZM9.12 14.41c-.98 0-1.79-.9-1.79-2.01 0-1.1.79-2.01 1.79-2.01s1.81.91 1.79 2.01c0 1.1-.79 2.01-1.79 2.01Zm5.76 0c-.98 0-1.79-.9-1.79-2.01 0-1.1.79-2.01 1.79-2.01s1.81.91 1.79 2.01c0 1.1-.79 2.01-1.79 2.01Z" />
    </svg>
  );
}
