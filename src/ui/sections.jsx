// sections.jsx — Status + headline metrics (always on top) → subsection nav → section detail.
const D = window.DATA;
const H = D.helpers;

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

function rangeLabel() {
  const n = D.days.length;
  const end = n ? D.days[n - 1] : null;
  const gran = (D.range && D.range.granularity) || "day";
  return {
    span: n + (gran === "1h" ? " hours" : " days"),
    through: end ? end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
  };
}

function Hero() {
  const status = D.all.status;
  const ok = status.verdict === "healthy";
  const word = VERDICT_WORD[status.verdict] || "Unknown";
  const pulse = ok ? "ok ok-bg" : status.verdict === "degraded" ? "bad bad-bg" : "";
  const r = rangeLabel();
  return (
    <div className="hero">
      <div>
        <div className="status-label">System status</div>
        <div className="status-line">
          <span className={"status-pulse " + pulse} />
          <span className="status-word">{word}</span>
        </div>
        <div className="status-reason">{statusReason(status, D.all.rolling)}</div>
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
// `roll` keys into D.all.rolling (14-day window); `rollFx` maps rolling.current into
// the unit the `fmt` expects (rolling friction/timing are ratios/ms). The sparkline
// keeps the raw per-day `values` series.
const KPI_LIST = [
  { label: "Friction rate", values: D.friction.total, roll: "friction", rollFx: (v) => v * 100, fmt: "pct1", goodDir: "down", section: "friction" },
  { label: "Tokens / day", values: D.tokens.total, roll: "tokensPerDay", fmt: "tok", goodDir: null, section: "tokens" },
  { label: "Cache hit", values: D.cache.hit, roll: "cacheHit", fmt: "ratio", goodDir: "up", section: "cache" },
  { label: "Tools / msg", values: D.tools.perMsg, roll: "toolsPerMessage", fmt: "num2", goodDir: null, section: "tools" },
  { label: "Avg turn", values: D.timing.turnDuration, roll: "avgTurnMs", rollFx: (v) => v / 1000, fmt: "sec", goodDir: "down", section: "timing" },
  { label: "Throughput", values: D.timing.throughput, roll: "throughput", fmt: (v) => v.toFixed(0), unit: " tok/s", goodDir: "up", section: "timing" },
  { label: "Time to first token", values: D.timing.ttft, roll: "avgTtftMs", fmt: "ms", goodDir: "down", section: "timing" },
  { label: "Reasoning share", values: D.reasoning.codex, roll: "reasoningShare", fmt: "ratio", goodDir: null, section: "reasoning" },
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

function KPI({ item, onPick }) {
  const fmtFn = typeof item.fmt === "function" ? item.fmt : FMT[item.fmt];
  const r = D.all.rolling[item.roll] || { current: 0, changeRatio: 0 };
  const cur = item.rollFx ? item.rollFx(r.current) : r.current;
  return (
    <button className="kpi" onClick={() => onPick(item.section)}>
      <div className="k-label">{item.label}</div>
      <div className="k-value num">{fmtFn(cur)}{item.unit && <span className="unit">{item.unit}</span>}</div>
      <div className="k-foot">
        <div className="k-spark"><Spark values={item.values} color="ghost" height={30} /></div>
        <RollDelta ratio={r.changeRatio} goodDir={item.goodDir} />
      </div>
      <div className="k-more">See more <span className="arr">→</span></div>
    </button>
  );
}
// harn:end ui-rolling-status-rendering

function HeadlineMetrics({ onPick }) {
  return (
    <>
      <div className="section-rule">
        <span className="eyebrow">01</span>
        <h3>Headline metrics</h3>
      </div>
      <div className="kpis">
        {KPI_LIST.map((it, i) => <KPI key={i} item={it} onPick={onPick} />)}
      </div>
    </>
  );
}

/* ---------------- sections ---------------- */
const SECTIONS = {
  friction: {
    title: "Friction", blurb: "How often turns go sideways — interrupts, retries, corrections — split by who caused it and how severe.",
    chart: { title: "Friction rate", sub: "total · % of turns with a friction signal · last 90 days", values: D.friction.total, dates: D.days, fmt: "pct1", color: "accent", goodDir: "down", now: () => H.last(D.friction.total).toFixed(1) + "%" },
    items: [["Friction by severity", "1pt vs 2pt tiers — stacked area"], ["User vs assistant split", "share of total friction"], ["Interrupts / retries per day", "bar"]],
  },
  activity: {
    title: "Activity", blurb: "Raw throughput of the system: how much conversation is happening and how it’s shaped.",
    chart: { title: "Sessions per day", sub: "distinct sessions · last 90 days", values: D.activity.sessions, dates: D.days, fmt: "int", color: "ink", goodDir: null, now: () => FMT.int(H.last(D.activity.sessions)) },
    items: [["Sessions · turns · messages / day", "grouped bar"], ["User vs assistant messages", "stacked bar"], ["Compactions per day", "KPI + bar"], ["Turns per session", "distribution"]],
  },
  tokens: {
    title: "Tokens", blurb: "Where the tokens go — by type, by model, and per session.",
    chart: { title: "Tokens per day", sub: "all models · all token types · last 90 days", values: D.tokens.total, dates: D.days, fmt: "tok", color: "ink", goodDir: null, now: () => FMT.tok(H.last(D.tokens.total)) },
    items: [["Token composition", "input / output / cache / reasoning — stacked"], ["Per-model token mix", "stacked bar"], ["Tokens per session", "distribution"]],
  },
  cache: {
    title: "Cache", blurb: "Cache economics — how much we’re reading back vs paying to create.",
    chart: { title: "Cache hit ratio", sub: "cache-read ÷ (read + creation + fresh input)", values: D.cache.hit, dates: D.days, fmt: "ratio", color: "ink", goodDir: "up", now: () => (H.last(D.cache.hit) * 100).toFixed(1) + "%" },
    items: [["Read vs creation vs fresh input", "stacked bar"], ["Savings estimate", "KPI"]],
  },
  reasoning: {
    title: "Reasoning", blurb: "Thinking budget — exact for Codex, estimated for Claude.",
    chart: { title: "Reasoning-token share (Codex)", sub: "reasoning ÷ output tokens · exact · last 90 days", values: D.reasoning.codex, dates: D.days, fmt: "ratio", color: "accent", goodDir: null, now: () => (H.last(D.reasoning.codex) * 100).toFixed(1) + "%" },
    items: [["Thinking-char share (Claude)", "line + KPI · estimate"]],
  },
  tools: {
    title: "Tools", blurb: "What the assistant reaches for, how much it produces, and where it fails.",
    bars: true,
    items: [["Tool output share", "output chars by tool"], ["Tool error rate by name", "good / bad bars"], ["Avg tool calls / message", "KPI + line"]],
  },
  timing: {
    title: "Timing", blurb: "Latency from the user’s seat — how fast it starts, runs, and finishes.",
    chart: { title: "Avg turn duration", sub: "wall-clock seconds per turn · last 90 days", values: D.timing.turnDuration, dates: D.days, fmt: "sec", color: "ink", goodDir: "down", now: () => H.last(D.timing.turnDuration).toFixed(1) + "s" },
    items: [["Time to first token", "line"], ["Avg tool latency", "line / bars by tool"], ["Output tokens / sec", "line + KPI"]],
  },
  limits: {
    title: "Rate limits", blurb: "Codex 5-hour and weekly windows — estimated time to exhaustion at the current burn, and time to reset.",
    limits: true,
    items: [["Burn-rate sparkline", "pending backend backlog item 7"], ["Token allowance estimate", "shown when local token deltas are observed"]],
  },
};

const NAV = ["friction", "activity", "tokens", "cache", "reasoning", "tools", "timing", "limits"];

function SubNav({ active, onChange }) {
  return (
    <div className="subnav-wrap">
      <span className="eyebrow">02 · Explore</span>
      <nav className="subnav" role="tablist">
        {NAV.map((id) => (
          <button key={id} role="tab" aria-selected={active === id}
            className="sx" onClick={() => onChange(id)}>{SECTIONS[id].title}</button>
        ))}
      </nav>
    </div>
  );
}

function ToolBars() {
  const totalCalls = D.tools.mix.reduce((a, t) => a + t.count, 0);
  const rows = [...D.tools.mix].sort((a, b) => b.count - a.count).map((t) => ({
    name: t.name, value: t.count, label: (t.count / totalCalls * 100).toFixed(1) + "%",
  }));
  return (
    <div>
      <div className="chart-head">
        <div>
          <div className="chart-title">Tool call mix</div>
          <div className="chart-sub">share of all tool invocations · last 90 days</div>
        </div>
        <div className="chart-now num">{FMT.int(totalCalls)}</div>
      </div>
      <HBars rows={rows} fmt="int" />
    </div>
  );
}

function FeaturedChart({ chart }) {
  return (
    <div>
      <div className="chart-head">
        <div>
          <div className="chart-title">{chart.title}</div>
          <div className="chart-sub">{chart.sub}</div>
        </div>
        <div className="chart-now num">{chart.now()}</div>
      </div>
      <MiniLine values={chart.values} dates={chart.dates} fmt={chart.fmt} color={chart.color} height={200} goodDir={chart.goodDir} />
    </div>
  );
}

// harn:assume ui-rate-limit-exhaustion-view ref=ui-rate-limit-view
// Account-wide rate-limit windows. Lead with percent-based time-to-exhaustion (the
// reliable figure — token allowance is not knowable per machine); burn is a current
// KPI (no sparkline until backend backlog item 7); rolling allowance shows only when
// the backend could estimate it (local token deltas observed).
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
  const primary = w.resetsFirst ? "resets first" : fmtHrs(w.percentTimeToExhaustHrs);
  const sub = w.resetsFirst ? "window resets before exhaustion" : "to exhaustion at current burn";
  return (
    <div className="lim-card">
      <div className="lim-title">{label}</div>
      <div className="lim-primary num">{primary}</div>
      <div className="lim-sub">{sub}</div>
      <div className="lim-row"><span>Resets in</span><span className="num">{fmtHrs(w.timeToResetHrs)}</span></div>
      <div className="lim-row"><span>Used</span><span className="num">{Math.round(w.usedPercent)}%</span></div>
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
          <div className="chart-title">Time to exhaustion</div>
          <div className="chart-sub">estimated hours until each window is exhausted at the current burn · account-wide</div>
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
              <div className="chart-sub">% of window consumed across samples toward reset · context only</div>
            </div>
            <div className="chart-now num">{Math.round(L.windowUsedPct * 100)}%</div>
          </div>
          <MiniLine values={L.windowHistory} fmt="ratio" color="accent" height={140} goodDir={null} compare={1} />
        </div>
      )}
    </div>
  );
}
// harn:end ui-rate-limit-exhaustion-view

function SectionDetail({ id }) {
  const cfg = SECTIONS[id];
  return (
    <div className="page-section">
      <div className="sd-head">
        <h2>{cfg.title}</h2>
        <p>{cfg.blurb}</p>
      </div>
      {cfg.chart && <FeaturedChart chart={cfg.chart} />}
      {cfg.limits && <RateLimits />}
      {cfg.bars && <ToolBars />}
      <div className="planned">
        <div className="planned-label">Coming to this section</div>
        {cfg.items.map((it, i) => (
          <div className="pi" key={i}>
            <span className="idx num">{String(i + 1).padStart(2, "0")}</span>
            <span>
              <span className="pt">{it[0]}</span>
              <span className="pk">{it[1]}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Hero, HeadlineMetrics, SubNav, SectionDetail });
