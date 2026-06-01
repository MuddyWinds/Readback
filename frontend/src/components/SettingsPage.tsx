import React, { useState } from "react";
import { AppSettings, DEFAULT_RUNTIME, FeedConfig, GEMINI_MODELS, RuntimeConfig, saveSettings, suggestAirportCode, verifiedFeedFields, verifyFeed } from "../lib/settings";
import { useSettings } from "../SettingsContext";

const MAX_FEEDS = 5;

type VerifyState = "idle" | "checking" | "ok" | "fail";

interface FeedRow extends FeedConfig {
  _persisted: boolean;
  _verify: VerifyState;
  _verifyMsg?: string;
}

const input: React.CSSProperties = {
  background: "#0d1117", color: "#e6edf3", border: "1px solid #30363d",
  borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, color: "#8b949e", fontWeight: 600, marginBottom: 4, display: "block",
};
const panel: React.CSSProperties = {
  background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "18px 20px",
};

function emptyRow(): FeedRow {
  return { url: "", airport_code: "", label: "", lat: null, lon: null, name: null, runways: [], _persisted: false, _verify: "idle" };
}

export function SettingsPage() {
  const { settings, reload } = useSettings();
  const [key, setKey] = useState(settings?.gemini_api_key ?? "");
  const [revealKey, setRevealKey] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeConfig>(settings?.runtime ?? DEFAULT_RUNTIME);
  const [feeds, setFeeds] = useState<FeedRow[]>(
    (settings?.feeds ?? []).map(f => ({ ...f, _persisted: true, _verify: "idle" as VerifyState }))
  );
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const updateFeed = (i: number, patch: Partial<FeedRow>) =>
    setFeeds(prev => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const onUrlChange = (i: number, url: string) => {
    const patch: Partial<FeedRow> = { url, _verify: "idle", _verifyMsg: undefined };
    if (!feeds[i]._persisted) patch.airport_code = suggestAirportCode(url);
    updateFeed(i, patch);
  };

  const onVerify = async (i: number) => {
    updateFeed(i, { _verify: "checking", _verifyMsg: undefined });
    const res = await verifyFeed(feeds[i].url);
    updateFeed(i, {
      _verify: res.ok ? "ok" : "fail",
      _verifyMsg: res.ok ? "Reachable, looks like audio" : (res.reason ?? "Verification failed"),
      ...verifiedFeedFields(res, feeds[i]._persisted),
    });
  };

  const onSave = async () => {
    setSaving(true); setSaveErr(null); setSaveMsg(null);
    const payload: AppSettings = {
      gemini_api_key: key,
      runtime,
      feeds: feeds
        .filter(f => f.url.trim() && f.airport_code.trim())
        .map(f => ({
          url: f.url.trim(),
          airport_code: f.airport_code.trim().toUpperCase(),
          label: f.label.trim(),
          lat: null, lon: null, name: null, runways: [],
        })),
    };
    try {
      await saveSettings(payload);
      setSaveMsg("Settings saved.");
      reload();
    } catch (e: any) {
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Settings</h2>

      <div style={panel}>
        <label style={labelStyle}>Gemini API key</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={input} type={revealKey ? "text" : "password"} value={key} placeholder="AIza..." onChange={e => setKey(e.target.value)} />
          <button onClick={() => setRevealKey(v => !v)} style={{ ...input, width: "auto", cursor: "pointer", minWidth: 70 }}>
            {revealKey ? "Hide" : "Show"}
          </button>
        </div>
        <p style={{ fontSize: 11, color: "#484f58", margin: "6px 0 0" }}>
          Applies immediately; the analyzer rebuilds its client on the next batch.
        </p>
      </div>

      <div style={panel}>
        <div style={{ ...labelStyle, fontSize: 13, color: "#e6edf3", marginBottom: 12 }}>Runtime</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <div>
            <label style={labelStyle}>Batch interval (seconds) - live</label>
            <input style={input} type="number" min={30} value={runtime.batch_interval_seconds}
              onChange={e => setRuntime({ ...runtime, batch_interval_seconds: Number(e.target.value) })} />
          </div>
          <div>
            <label style={labelStyle}>Max transcripts per batch - live</label>
            <input style={input} type="number" min={1} value={runtime.batch_max_items}
              onChange={e => setRuntime({ ...runtime, batch_max_items: Number(e.target.value) })} />
          </div>
          <div>
            <label style={labelStyle}>RMS silence threshold - live</label>
            <input style={input} type="number" step="0.001" min={0} value={runtime.stt_rms_threshold}
              onChange={e => setRuntime({ ...runtime, stt_rms_threshold: Number(e.target.value) })} />
          </div>
          <div>
            <label style={labelStyle}>Whisper model - restart required</label>
            <select style={input} value={runtime.whisper_model}
              onChange={e => setRuntime({ ...runtime, whisper_model: e.target.value })}>
              {["tiny", "base", "small", "medium", "large"].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>STT concurrency - restart required</label>
            <input style={input} type="number" min={1} value={runtime.stt_concurrency}
              onChange={e => setRuntime({ ...runtime, stt_concurrency: Number(e.target.value) })} />
          </div>
          <div>
            <label style={labelStyle}>Alert threshold (toast on / above)</label>
            <select style={input} value={runtime.alert_min_severity}
              onChange={e => setRuntime({ ...runtime, alert_min_severity: e.target.value as RuntimeConfig["alert_min_severity"] })}>
              {(["low", "medium", "high", "critical"] as const).map(s =>
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Gemini model - live</label>
            <select style={input} value={runtime.gemini_model}
              onChange={e => setRuntime({ ...runtime, gemini_model: e.target.value })}>
              {GEMINI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
          <span style={{ fontSize: 13, color: "#e6edf3", fontWeight: 600 }}>ATC feeds ({feeds.length}/{MAX_FEEDS})</span>
          <button
            onClick={() => setFeeds(prev => (prev.length >= MAX_FEEDS ? prev : [...prev, emptyRow()]))}
            disabled={feeds.length >= MAX_FEEDS}
            style={{ ...input, width: "auto", cursor: feeds.length >= MAX_FEEDS ? "not-allowed" : "pointer", minWidth: 98 }}
          >
            + Add feed
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {feeds.map((f, i) => (
            <div key={i} style={{ border: "1px solid #21262d", borderRadius: 6, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <label style={labelStyle}>LiveATC URL</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={input} value={f.url} placeholder="http://audio.liveatc.net/kjfk9_s" onChange={e => onUrlChange(i, e.target.value)} />
                  <button onClick={() => onVerify(i)} disabled={!f.url.trim() || f._verify === "checking"} style={{ ...input, width: "auto", cursor: "pointer", minWidth: 88 }}>
                    {f._verify === "checking" ? "Checking..." : "Verify"}
                  </button>
                </div>
                {f._verifyMsg && (
                  <p style={{ fontSize: 11, margin: "4px 0 0", color: f._verify === "ok" ? "#3fb950" : "#ff4444" }}>
                    {f._verifyMsg}
                  </p>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(160px, 1fr) auto", gap: 8, alignItems: "end" }}>
                <div>
                  <label style={labelStyle}>Airport code{f._persisted ? " - fixed" : " - suggested"}</label>
                  <input style={{ ...input, opacity: f._persisted ? 0.6 : 1 }} value={f.airport_code}
                    disabled={f._persisted}
                    title={f._persisted ? "Codes are fixed after saving; remove and re-add to change" : undefined}
                    onChange={e => updateFeed(i, { airport_code: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label style={labelStyle}>Label (optional)</label>
                  <input style={input} value={f.label} placeholder={f.airport_code || "e.g. JFK Tower"} onChange={e => updateFeed(i, { label: e.target.value })} />
                </div>
                <button onClick={() => setFeeds(prev => prev.filter((_, idx) => idx !== i))} style={{ ...input, width: "auto", cursor: "pointer", color: "#ff7b72", minWidth: 86 }}>
                  Remove
                </button>
              </div>
              {f.lat != null && (
                <p style={{ fontSize: 11, color: "#484f58", margin: 0 }}>
                  Map position: {f.lat.toFixed(2)}, {f.lon!.toFixed(2)} - {f.runways.length} runway(s) on file
                </p>
              )}
              {f.airport_code && f.lat == null && (
                <p style={{ fontSize: 11, color: "#e3b341", margin: 0 }}>
                  Unknown airport code: no map marker or runway overlay.
                </p>
              )}
            </div>
          ))}
          {feeds.length === 0 && <p style={{ fontSize: 12, color: "#8b949e", margin: 0 }}>No feeds yet. Add at least one.</p>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button onClick={onSave} disabled={saving}
          style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "9px 20px", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>
          {saving ? "Saving..." : "Save settings"}
        </button>
        {saveMsg && <span style={{ color: "#3fb950", fontSize: 13 }}>{saveMsg}</span>}
        {saveErr && <span style={{ color: "#ff4444", fontSize: 13 }}>{saveErr}</span>}
      </div>
    </div>
  );
}
