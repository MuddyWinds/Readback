const API_BASE = "http://localhost:8000";

export interface Runway { ident: string; heading_deg: number; }

export interface FeedConfig {
  url: string;
  airport_code: string;
  label: string;
  lat: number | null;
  lon: number | null;
  name: string | null;
  runways: Runway[];
}

export interface RuntimeConfig {
  batch_interval_seconds: number;
  stt_rms_threshold: number;
  whisper_model: string;
  stt_concurrency: number;
}

export interface AppSettings {
  gemini_api_key: string;
  feeds: FeedConfig[];
  runtime: RuntimeConfig;
}

export interface VerifyFeedResult {
  ok: boolean;
  status?: number;
  content_type?: string;
  suggested_code?: string;
  reason?: string | null;
}

export async function fetchSettings(): Promise<AppSettings> {
  const r = await fetch(`${API_BASE}/api/settings`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export async function saveSettings(s: AppSettings): Promise<AppSettings> {
  const r = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.detail || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

export async function verifyFeed(url: string): Promise<VerifyFeedResult> {
  const r = await fetch(`${API_BASE}/api/settings/verify-feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return r.json();
}

export function suggestAirportCode(url: string): string {
  const segment = url.replace(/\/+$/, "").split("/").pop() ?? "";
  const alpha = segment.match(/^[A-Za-z]+/);
  return alpha ? alpha[0].toUpperCase().slice(0, 4) : "";
}

export function geoByCode(feeds: FeedConfig[]): Record<string, [number, number]> {
  const map: Record<string, [number, number]> = {};
  for (const f of feeds) {
    if (f.lat != null && f.lon != null) map[f.airport_code] = [f.lat, f.lon];
  }
  return map;
}
