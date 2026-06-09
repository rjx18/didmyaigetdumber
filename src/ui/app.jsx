// app.jsx — shell: brand + theme on top; headline metrics route to the subsection nav below.
const { useEffect, useRef, useState } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "density": "regular",
  "accent": "#5b6b97",
  "baseline": true
}/*EDITMODE-END*/;

const ACCENTS = ["#5b6b97", "#6b7a72", "#8a7a6b", "#7a6b8a", "#4f4f55"];

// harn:assume ui-live-data-binding ref=ui-app-states
// Shown when /api/ui returned no daily logs (empty) or the fetch failed (error).
// Reuses the status classes so the message matches the dashboard's visual language.
function DataNotice({ state }) {
  const empty = state === "empty";
  return (
    <div className="hero" style={{ display: "block" }}>
      <div className="status-label">{empty ? "No data yet" : "Couldn’t load data"}</div>
      <div className="status-line">
        <span className={"status-pulse " + (empty ? "" : "bad bad-bg")} />
        <span className="status-word">{empty ? "Nothing tracked" : "Offline"}</span>
      </div>
      <div className="status-reason">
        {empty
          ? "No sessions have been recorded yet. Run a Codex or Claude Code session, or backfill history, then refresh."
          : "The dashboard could not reach the local /api/ui endpoint."}
        {!empty && window.DATA_ERROR ? <span className="num"> ({window.DATA_ERROR})</span> : null}
        <div className="num" style={{ marginTop: 10, color: "var(--faint)" }}>
          {empty ? "didmyaigetdumber backfill all" : "didmyaigetdumber start"}
        </div>
      </div>
    </div>
  );
}
// harn:end ui-live-data-binding

// harn:assume ui-model-selector ref=ui-model-selector-control
// Persisted model selection. Drops the <synthetic> pseudo-model and zero-token
// models, friendly-names long ids, and keeps the choice in localStorage. The chosen
// model is turned into a scope (window.buildScope) that drives every section.
const MODEL_KEY = "ait_model";

function friendlyModel(name) {
  if (!name) return "unknown";
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function modelOptions() {
  const models = (window.DATA.models || [])
    .filter((m) => m.id !== "<synthetic>" && m.tokens > 0)
    .map((m) => ({ id: m.id, label: friendlyModel(m.name) }));
  return [{ id: "all", label: "All models" }].concat(models);
}

function useModel() {
  const options = modelOptions();
  const valid = new Set(options.map((o) => o.id));
  const stored = localStorage.getItem(MODEL_KEY);
  const [model, set] = useState(stored && valid.has(stored) ? stored : "all");
  const setModel = (v) => { localStorage.setItem(MODEL_KEY, v); set(v); };
  return [model, setModel, options];
}

function ModelSelector({ model, options, coverage, onChange }) {
  if (options.length <= 1) return null;   // only "All models" — nothing to toggle
  const cov = model !== "all" && coverage && coverage.tokens != null
    ? Math.round(coverage.tokens * 100) + "% of tokens" : null;
  return (
    <label className="model-select">
      <span className="model-select-label">Model</span>
      <select value={model} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {cov && <span className="model-cov num">{cov}</span>}
    </label>
  );
}
// harn:end ui-model-selector

// harn:assume ui-breakdown-control ref=ui-breakdown-toggle
// Overall vs By-model breakdown for the All-models featured chart, rendered in the
// explore row next to the granularity control. "Overall" is the single server-weighted
// aggregate; "By model" overlays one line per model.
const BREAKDOWN_KEY = "ait_breakdown";

function useBreakdown() {
  const stored = localStorage.getItem(BREAKDOWN_KEY);
  const [breakdown, set] = useState(stored === "overall" || stored === "bymodel" ? stored : "bymodel");
  const setBreakdown = (v) => { localStorage.setItem(BREAKDOWN_KEY, v); set(v); };
  return [breakdown, setBreakdown];
}

function BreakdownToggle({ value, onChange }) {
  return (
    <div className="seg" role="group" aria-label="Breakdown">
      {[["bymodel", "By model"], ["overall", "Overall"]].map(([id, label]) => (
        <button key={id} className={"seg-btn" + (value === id ? " on" : "")} aria-pressed={value === id}
          onClick={() => value !== id && onChange(id)}>{label}</button>
      ))}
    </div>
  );
}
// harn:end ui-breakdown-control

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [section, setSection] = useState(() => {
    const stored = localStorage.getItem("ait_section");
    return stored && window.SECTION_IDS && window.SECTION_IDS.indexOf(stored) >= 0 ? stored : "friction";
  });
  const [model, setModel, modelOpts] = useModel();
  const [breakdown, setBreakdown] = useBreakdown();
  const [data, setData] = useState(window.DATA);
  const [gran, setGran] = useState((window.DATA.range && window.DATA.range.granularity) || "day");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const detailRef = useRef(null);

  const dataState = err ? "error" : (data && data.N ? "ok" : (window.DATA_STATE === "error" ? "error" : "empty"));
  const scope = dataState === "ok" ? window.buildScope(data, model) : null;

  // In-place re-fetch on granularity change — no page reload, scroll preserved.
  const changeGranularity = (g) => {
    setLoading(true);
    window.loadUiData(window.UI_DAYS, g).then((d) => {
      setData(d); setGran(g); setErr(null);
      const p = new URLSearchParams(window.location.search);
      if (g === "day") p.delete("granularity"); else p.set("granularity", g);
      const qs = p.toString();
      window.history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
    }).catch((e) => {
      setErr(e);
      window.DATA_ERROR = String((e && e.message) || e);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { localStorage.setItem("ait_section", section); }, [section]);

  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", t.dark ? "dark" : "light");
    r.setAttribute("data-density", t.density);
    r.style.setProperty("--accent", t.accent);
    document.body.classList.toggle("no-axis", !t.baseline);
  }, [t.dark, t.density, t.accent, t.baseline]);

  const goTo = (s) => {
    setSection(s);
    requestAnimationFrame(() => {
      const el = detailRef.current;
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 72;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    });
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="dot" />
            didmyaigetdumber
            <span className="sub">/ telemetry</span>
          </div>
          <span className="spacer" />
          {dataState === "ok" && (
            <ModelSelector model={model} options={modelOpts} coverage={scope && scope.coverage} onChange={setModel} />
          )}
          <button className="ghost-btn" onClick={() => setTweak("dark", !t.dark)}>
            {t.dark ? "◑ dark" : "◐ light"}
          </button>
        </div>
      </header>

      <main>
        <div className="page wrap">
          {dataState === "ok" ? (
            <>
              <Hero scope={scope} />
              <HeadlineMetrics scope={scope} onPick={goTo} />
              <div ref={detailRef} className={"detail" + (loading ? " loading" : "")}>
                <SubNav active={section} onChange={setSection}
                  granularity={gran} onGranularity={changeGranularity} loading={loading}>
                  {model === "all" && <BreakdownToggle value={breakdown} onChange={setBreakdown} />}
                </SubNav>
                <SectionDetail id={section} scope={scope} breakdown={breakdown} />
              </div>
            </>
          ) : (
            <DataNotice state={dataState} />
          )}
        </div>
      </main>

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakRadio label="Density" value={t.density} options={["compact", "regular"]}
          onChange={(v) => setTweak("density", v)} />
        <TweakColor label="Accent line" value={t.accent} options={ACCENTS}
          onChange={(v) => setTweak("accent", v)} />
        <TweakSection label="Charts" />
        <TweakToggle label="Baseline axis" value={t.baseline} onChange={(v) => setTweak("baseline", v)} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
