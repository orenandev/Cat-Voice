type Value = string | number | boolean | null | Value[];

function parseValue(raw: string): Value {
  let text = raw.trim();
  const typed = text.match(/^(?:Packed\w+Array|Array\[\w+\])\(([\s\S]*)\)$/);
  if (typed) text = `[${typed[1]}]`;
  if (text === "true" || text === "false") return text === "true";
  if (text === "null") return null;
  try {
    return JSON.parse(text) as Value;
  } catch {
    const num = Number(text);
    if (text !== "" && !Number.isNaN(num)) return num;
    return text.replace(/^"(.*)"$/s, "$1");
  }
}

export function parseGodotConfig(source: string): Record<string, Record<string, Value>> {
  const result: Record<string, Record<string, Value>> = {};
  let section = "";
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);
  let pending = "";
  let pendingKey = "";
  for (const line of lines) {
    if (pendingKey) {
      pending += "\n" + line;
      if (balanced(pending)) {
        (result[section] ??= {})[pendingKey] = parseValue(pending);
        pendingKey = "";
        pending = "";
      }
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    const header = trimmed.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1];
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!balanced(value)) {
      pendingKey = key;
      pending = value;
      continue;
    }
    (result[section] ??= {})[key] = parseValue(value);
  }
  return result;
}

function balanced(text: string) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "(" || c === "{") depth++;
    else if (c === "]" || c === ")" || c === "}") depth--;
  }
  return depth <= 0 && !inString;
}

export function flatConfig(source: string) {
  const parsed = parseGodotConfig(source);
  return { ...(parsed[""] ?? {}), ...(parsed.data ?? {}) } as Record<string, Value>;
}

export function asString(v: Value | undefined) {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

export function asStringArray(v: Value | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  if (typeof v === "string" && v) return [v];
  return [];
}

export function asNumberArray(v: Value | undefined): number[] {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (typeof v === "number") return [v];
  return [];
}
