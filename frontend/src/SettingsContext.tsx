import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppSettings, fetchSettings, geoByCode } from "./lib/settings";

interface SettingsContextValue {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  needsSetup: boolean;
  geo: Record<string, [number, number]>;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetchSettings()
      .then(s => { setSettings(s); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const needsSetup = !!settings && (!settings.gemini_api_key || settings.feeds.length === 0);
  const geo = settings ? geoByCode(settings.feeds) : {};

  return (
    <SettingsContext.Provider value={{ settings, loading, error, reload, needsSetup, geo }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
