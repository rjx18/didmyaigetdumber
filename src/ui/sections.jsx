// sections.jsx — Status + headline metrics (always on top) → subsection nav → section detail.
const D = window.DATA;
const H = D.helpers;

// harn:assume ui-model-selector ref=ui-model-scope
// A model "scope" carries the active series/rolling/status/tool-mix for the selected
// model, plus the shared days/range/limits/models/byModel the sections need. It is
// built from the *current* data object (re-fetched in place), so a granularity change
// flows through. "all" reads the aggregate; a model id reads byModel[id]. Rate-limit
// windows are account-wide and intentionally NOT model-scoped.
function buildScope(data, model) {
  const shared = {
    days: data.days, range: data.range || {}, limits: data.limits || {},
    models: data.models || [], byModel: data.byModel || {},
  };
  const m = model && model !== "all" ? (data.byModel || {})[model] : null;
  if (m) {
    return Object.assign({}, shared, {
      model, series: m.series, rolling: m.rolling, status: m.status,
      toolsMix: (m.aggregates && m.aggregates.tools) || (m.series.tools && m.series.tools.mix) || [],
      coverage: m.coverage || null,
    });
  }
  const allSeries = {
    friction: data.friction, activity: data.activity, tokens: data.tokens, cache: data.cache,
    reasoning: data.reasoning, tools: data.tools, timing: data.timing,
  };
  return Object.assign({}, shared, {
    model: "all", series: allSeries, rolling: data.all.rolling, status: data.all.status,
    toolsMix: data.tools.mix, coverage: null,
  });
}
// harn:end ui-model-selector

/* ---------------- status (server-computed) ---------------- */
// harn:assume ui-rolling-status-rendering ref=ui-status-hero
const VERDICT_WORD = { healthy: "Healthy", degraded: "Degraded", "insufficient-data": "Insufficient data" };
const SIGNAL_LABEL = { friction: "friction", cache: "cache hit", toolError: "tool error rate" };

// Narrative derived from the API status signals + the 14-day friction rolling trend.
function statusReason(status, rolling) {
  if (status.verdict === "insufficient-data") {
    return "Not enough recent activity to judge — run more sessions or widen the range.";
  }
  const fr = (rolling && rolling.friction) || {};
  const frPct = fr.changeRatio == null ? null : Math.round(fr.changeRatio * 100);
  const trend = frPct == null ? "" :
    frPct > 0 ? ` Friction is climbing (+${frPct}% over 14d) and is worth watching.` :
    frPct < 0 ? ` Friction is easing (${frPct}% over 14d).` : "";
  const bad = Object.keys(status.signals).filter((k) => status.signals[k].degraded);
  if (bad.length === 0) return "All core signals within range." + trend;
  return "Above threshold: " + bad.map((k) => SIGNAL_LABEL[k] || k).join(" · ") + "." + trend;
}

function rangeLabel(scope) {
  const days = scope.days || [];
  const n = days.length;
  const end = n ? days[n - 1] : null;
  const gran = (scope.range && scope.range.granularity) || "day";
  return {
    span: n + (gran === "1h" ? " hours" : " days"),
    through: end ? end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
  };
}

function Hero({ scope }) {
  const status = scope.status;
  const ok = status.verdict === "healthy";
  const word = VERDICT_WORD[status.verdict] || "Unknown";
  const pulse = ok ? "ok ok-bg" : status.verdict === "degraded" ? "bad bad-bg" : "";
  const r = rangeLabel(scope);
  return (
    <div className="hero">
      <div>
        <div className="status-label">System status</div>
        <div className="status-line">
          <span className={"status-pulse " + pulse} />
          <span className="status-word">{word}</span>
        </div>
        <div className="status-reason">{statusReason(status, scope.rolling)}</div>
      </div>
      <div className="status-meta">
        <div>last {r.span} · live</div>
        <div>through <span className="num">{r.through}</span></div>
      </div>
    </div>
  );
}
// harn:end ui-rolling-status-rendering

/* ---------------- headline metrics (clickable → route) ---------------- */
// harn:assume ui-rolling-status-rendering ref=ui-rolling-kpis
// `pick` selects the sparkline series from the active model scope; `roll` keys into
// scope.rolling (14-day window); `rollFx` maps rolling.current into the unit the
// `fmt` expects (rolling friction/timing are ratios/ms).
const KPI_LIST = [
  { label: "Friction rate", pick: (s) => s.friction.total, roll: "friction", rollFx: (v) => v * 100, fmt: "pct1", goodDir: "down", section: "friction" },
  { label: "Tokens / day", pick: (s) => s.tokens.total, roll: "tokensPerDay", fmt: "tok", goodDir: null, section: "tokens" },
  { label: "Cache hit", pick: (s) => s.cache.hit, roll: "cacheHit", fmt: "ratio", goodDir: "up", section: "cache" },
  { label: "Tools / msg", pick: (s) => s.tools.perMsg, roll: "toolsPerMessage", fmt: "num2", goodDir: null, section: "tools" },
  { label: "Avg turn", pick: (s) => s.timing.turnDuration, roll: "avgTurnMs", rollFx: (v) => v / 1000, fmt: "sec", goodDir: "down", section: "timing" },
  { label: "Throughput", pick: (s) => s.timing.throughput, roll: "throughput", fmt: (v) => v.toFixed(0), unit: " tok/s", goodDir: "up", section: "timing" },
  { label: "Time to first token", pick: (s) => s.timing.ttft, roll: "avgTtftMs", fmt: "ms", goodDir: "down", section: "timing" },
  { label: "Reasoning share", pick: (s) => s.reasoning.codex, roll: "reasoningShare", fmt: "ratio", goodDir: null, section: "reasoning" },
];

// Delta badge fed by the 14-day rolling changeRatio (current vs previous window).
function RollDelta({ ratio, goodDir }) {
  const dv = ratio == null ? 0 : ratio;
  const arrow = dv > 0.001 ? "↑" : dv < -0.001 ? "↓" : "→";
  let cls = "flat";
  if (goodDir && Math.abs(dv) > 0.002) {
    const dir = dv > 0 ? "up" : "down";
    cls = dir + "-" + (dir === goodDir ? "good" : "bad");
  }
  const sign = dv > 0 ? "+" : "";
  return <span className={"delta " + cls}>{arrow} {sign}{(dv * 100).toFixed(1)}%</span>;
}

function KPI({ item, scope, onPick }) {
  const fmtFn = typeof item.fmt === "function" ? item.fmt : FMT[item.fmt];
  const r = scope.rolling[item.roll] || { current: 0, changeRatio: 0 };
  const cur = item.rollFx ? item.rollFx(r.current) : r.current;
  const values = item.pick(scope.series);
  return (
    <button className="kpi" onClick={() => onPick(item.section)}>
      <div className="k-label">{item.label}</div>
      <div className="k-value num">{fmtFn(cur)}{item.unit && <span className="unit">{item.unit}</span>}</div>
      <div className="k-foot">
        <div className="k-spark"><Spark values={values} color="ghost" height={30} /></div>
        <RollDelta ratio={r.changeRatio} goodDir={item.goodDir} />
      </div>
      <div className="k-more">See more <span className="arr">→</span></div>
    </button>
  );
}
// harn:end ui-rolling-status-rendering

function HeadlineMetrics({ scope, onPick }) {
  return (
    <>
      <div className="section-rule">
        <span className="eyebrow">01</span>
        <h3>Headline metrics</h3>
      </div>
      <div className="kpis">
        {KPI_LIST.map((it, i) => <KPI key={i} item={it} scope={scope} onPick={onPick} />)}
      </div>
    </>
  );
}

/* ---------------- sections ---------------- */
const SECTIONS = {
  friction: {
    title: "Friction", blurb: "How often turns go sideways — interrupts, retries, corrections — split by who caused it and how severe.",
    chart: { title: "Friction rate", sub: "total · % of turns with a friction signal", pick: (s) => s.friction.total, fmt: "pct1", color: "accent", goodDir: "down", now: (s) => H.last(s.friction.total).toFixed(1) + "%" },
  },
  activity: {
    title: "Activity", blurb: "Raw throughput of the system: how much conversation is happening and how it’s shaped.",
    chart: { title: "Sessions per day", sub: "distinct sessions", pick: (s) => s.activity.sessions, fmt: "int", color: "ink", goodDir: null, now: (s) => FMT.int(H.last(s.activity.sessions)) },
  },
  tokens: {
    title: "Tokens", blurb: "Where the tokens go — by type, by model, and per session.",
    chart: { title: "Tokens per day", sub: "all token types", pick: (s) => s.tokens.total, fmt: "tok", color: "ink", goodDir: null, now: (s) => FMT.tok(H.last(s.tokens.total)) },
  },
  cache: {
    title: "Cache", blurb: "Cache economics — how much we’re reading back vs paying to create.",
    chart: { title: "Cache hit ratio", sub: "cache-read ÷ (read + creation + fresh input)", pick: (s) => s.cache.hit, fmt: "ratio", color: "ink", goodDir: "up", now: (s) => (H.last(s.cache.hit) * 100).toFixed(1) + "%" },
  },
  reasoning: {
    title: "Reasoning", blurb: "Thinking budget — exact for Codex, estimated for Claude.",
    chart: { title: "Reasoning-token share (Codex)", sub: "reasoning ÷ output tokens · exact", pick: (s) => s.reasoning.codex, fmt: "ratio", color: "accent", goodDir: null, now: (s) => (H.last(s.reasoning.codex) * 100).toFixed(1) + "%" },
  },
  tools: {
    title: "Tools", blurb: "What the assistant reaches for, how much it produces, and where it fails.",
    bars: true,
  },
  timing: {
    title: "Timing", blurb: "Latency from the user’s seat — how fast it starts, runs, and finishes.",
    chart: { title: "Avg turn duration", sub: "wall-clock seconds per turn", pick: (s) => s.timing.turnDuration, fmt: "sec", color: "ink", goodDir: "down", now: (s) => H.last(s.timing.turnDuration).toFixed(1) + "s" },
  },
  limits: {
    title: "Rate limits", blurb: "Codex 5-hour and weekly windows — estimated time to exhaustion at the current burn, and time to reset.",
    limits: true,
  },
};

const NAV = ["friction", "activity", "tokens", "cache", "reasoning", "tools", "timing", "limits"];

// harn:assume ui-granularity-live-refetch ref=ui-granularity-control
// Detailed-charts granularity. Calls onChange(g) so App re-fetches in place (no page
// reload); the server re-buckets the series and the 14-day rolling KPIs/status are
// unaffected. `1h` is bounded server-side to the hourly retention window.
const GRANULARITIES = ["1h", "day", "week", "2w", "month"];

function GranularityControl({ current, loading, onChange }) {
  const active = current || "day";
  return (
    <div className={"gran" + (loading ? " loading" : "")} role="group" aria-label="Chart granularity">
      {GRANULARITIES.map((g) => (
        <button key={g} className={"gran-btn" + (active === g ? " on" : "")}
          aria-pressed={active === g} disabled={loading}
          onClick={() => active !== g && onChange(g)}>{g}</button>
      ))}
    </div>
  );
}
// harn:end ui-granularity-live-refetch

function SubNav({ active, onChange, granularity, onGranularity, loading }) {
  return (
    <div className="subnav-wrap">
      <span className="eyebrow">02 · Explore</span>
      <nav className="subnav" role="tablist">
        {NAV.map((id) => (
          <button key={id} role="tab" aria-selected={active === id}
            className="sx" onClick={() => onChange(id)}>{SECTIONS[id].title}</button>
        ))}
      </nav>
      <GranularityControl current={granularity} loading={loading} onChange={onGranularity} />
    </div>
  );
}

function ToolBars({ scope }) {
  const mix = scope.toolsMix || [];
  const totalCalls = mix.reduce((a, t) => a + t.count, 0);
  const rows = [...mix].sort((a, b) => b.count - a.count).map((t) => ({
    name: t.name, value: t.count, label: totalCalls ? (t.count / totalCalls * 100).toFixed(1) + "%" : "0%",
  }));
  return (
    <div>
      <div className="chart-head">
        <div>
          <div className="chart-title">Tool call mix</div>
          <div className="chart-sub">share of all tool invocations</div>
        </div>
        <div className="chart-now num">{FMT.int(totalCalls)}</div>
      </div>
      <HBars rows={rows} fmt="int" />
    </div>
  );
}

// harn:assume ui-per-model-multiline ref=featured-multimodel
// Distinct per-model line colors for the All-models overlay.
const MODEL_COLORS = ["#5b6b97", "#6b8a72", "#a0795c", "#9c5c7a", "#5c8a9c", "#8a7a5c", "#7a5c9c"];
const modelLabel = (name) => { const i = name.lastIndexOf("/"); return i >= 0 ? name.slice(i + 1) : name; };

function FeaturedChart({ chart, scope }) {
  const models = (scope.models || []).filter((m) => m.id !== "<synthetic>" && m.tokens > 0 && scope.byModel[m.id]);
  const multi = scope.model === "all" && models.length >= 2;
  return (
    <div>
      <div className="chart-head">
        <div>
          <div className="chart-title">{chart.title}</div>
          <div className="chart-sub">{chart.sub}{multi ? " · by model" : ""}</div>
        </div>
        <div className="chart-now num">{chart.now(scope.series)}</div>
      </div>
      {multi ? (
        <MultiLine
          lines={models.map((m, i) => ({
            name: modelLabel(m.name),
            color: MODEL_COLORS[i % MODEL_COLORS.length],
            values: chart.pick(scope.byModel[m.id].series),
          }))}
          dates={scope.days} fmt={chart.fmt} height={220} />
      ) : (
        <MiniLine values={chart.pick(scope.series)} dates={scope.days} fmt={chart.fmt} color={chart.color} height={200} goodDir={chart.goodDir} />
      )}
    </div>
  );
}
// harn:end ui-per-model-multiline

// harn:assume ui-rate-limit-window-cards ref=ui-rate-limit-view
// Account-wide rate-limit windows. Lead with when the window resets and how full it
// is (both always meaningful); time-to-exhaustion is only a conditional warning when
// you're on pace to run out before the window resets. Token allowance is not knowable
// per machine, so it shows only when the backend could estimate it.
function fmtHrs(h) {
  if (h == null) return "—";
  if (h < 1) return Math.round(h * 60) + "m";
  if (h < 48) return h.toFixed(1) + "h";
  return (h / 24).toFixed(1) + "d";
}

function WindowCard({ label, w }) {
  if (!w) {
    return (
      <div className="lim-card">
        <div className="lim-title">{label}</div>
        <div className="lim-empty">no samples in range</div>
      </div>
    );
  }
  const used = Math.round(w.usedPercent);
  const exhaust = w.percentTimeToExhaustHrs;
  const reset = w.timeToResetHrs;
  let statusCls = "ok";
  let statusText = "On track — resets before exhaustion.";
  if (exhaust == null) {
    statusCls = "muted";
    statusText = "Burn rate unknown — not enough samples yet.";
  } else if (reset != null && exhaust < reset) {
    statusCls = "warn";
    statusText = "On pace to exhaust in " + fmtHrs(exhaust) + " — before it resets.";
  }
  return (
    <div className="lim-card">
      <div className="lim-title">{label}</div>
      <div className="lim-primary num">{fmtHrs(reset)}</div>
      <div className="lim-sub">until reset</div>
      <div className="lim-bar"><span style={{ width: Math.min(100, used) + "%" }} /></div>
      <div className="lim-used"><span className="num">{used}%</span> used</div>
      <div className={"lim-status " + statusCls}>{statusText}</div>
      <div className="lim-row"><span>Burn</span><span className="num">{w.burnPctPointsPerHour == null ? "—" : w.burnPctPointsPerHour.toFixed(1) + " pp/h"}</span></div>
      {w.localAllowanceEstimateRolling != null && (
        <div className="lim-row"><span>Allowance · 14d</span><span className="num">{FMT.tok(w.localAllowanceEstimateRolling)}</span></div>
      )}
    </div>
  );
}

function RateLimits() {
  const L = D.limits;
  return (
    <div>
      <div className="chart-head">
        <div>
          <div className="chart-title">Rate-limit windows</div>
          <div className="chart-sub">time until each window resets and how full it is · account-wide</div>
        </div>
      </div>
      <div className="lim-grid">
        <WindowCard label="5-hour window" w={L.fiveHour} />
        <WindowCard label="Weekly window" w={L.weekly} />
      </div>
      {L.windowHistory && L.windowHistory.length > 1 && (
        <div style={{ marginTop: 24 }}>
          <div className="chart-head">
            <div>
              <div className="chart-title">5h window usage</div>
              <div className="chart-sub">% of window consumed across samples toward reset</div>
            </div>
            <div className="chart-now num">{Math.round(L.windowUsedPct * 100)}%</div>
          </div>
          <MiniLine values={L.windowHistory} fmt="ratio" color="accent" height={140} goodDir={null} compare={1} />
        </div>
      )}
    </div>
  );
}
// harn:end ui-rate-limit-window-cards

function SectionDetail({ id, scope }) {
  const cfg = SECTIONS[id];
  return (
    <div className="page-section">
      <div className="sd-head">
        <h2>{cfg.title}</h2>
        <p>{cfg.blurb}</p>
      </div>
      {cfg.chart && <FeaturedChart chart={cfg.chart} scope={scope} />}
      {cfg.limits && <RateLimits />}
      {cfg.bars && <ToolBars scope={scope} />}
    </div>
  );
}

Object.assign(window, { Hero, HeadlineMetrics, SubNav, SectionDetail, buildScope });
