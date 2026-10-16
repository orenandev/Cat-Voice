import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local (veja o .env.example).");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
  realtime: { worker: true },
});

export async function accessToken() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sessão expirada, entre novamente.");
  return data.session.access_token;
}

export function errorMessage(err: unknown) {
  if (!err) return "Erro desconhecido";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return "Erro desconhecido";
}
