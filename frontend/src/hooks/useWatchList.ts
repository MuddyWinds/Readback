import React from "react";

// ── Module-level watch list (reactive across all card instances) ──────────────
const _watchListeners = new Set<() => void>();
function _getWatchSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem("atc_watchlist") || "[]")); }
  catch { return new Set(); }
}
export function useWatchList(): [Set<string>, (cs: string) => void] {
  const [list, setList] = React.useState<Set<string>>(_getWatchSet);
  React.useEffect(() => {
    const upd = () => setList(new Set(_getWatchSet()));
    _watchListeners.add(upd);
    return () => { _watchListeners.delete(upd); };
  }, []);
  const toggle = React.useCallback((cs: string) => {
    const next = _getWatchSet();
    if (next.has(cs)) next.delete(cs); else next.add(cs);
    localStorage.setItem("atc_watchlist", JSON.stringify(Array.from(next)));
    _watchListeners.forEach(fn => fn());
  }, []);
  return [list, toggle];
}
