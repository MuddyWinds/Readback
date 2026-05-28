// Single source of truth for the backend origin.
//
// Default = the page's own origin, so a build served from any host reaches the
// API on that host. VITE_API_BASE / VITE_WS_URL override this for the Vite
// dev server (:3000 -> backend :8000) and for split-origin deployments.

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export function resolveApiBase(
  env: { VITE_API_BASE?: string },
  loc: { origin: string },
): string {
  const override = env.VITE_API_BASE?.trim();
  return trimTrailingSlash(override || loc.origin);
}

export function resolveWsUrl(
  env: { VITE_WS_URL?: string },
  loc: { protocol: string; host: string },
): string {
  const override = env.VITE_WS_URL?.trim();
  if (override) return override;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws/live`;
}

export const API_BASE = resolveApiBase(import.meta.env, window.location);
export const WS_URL = resolveWsUrl(import.meta.env, window.location);

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}
