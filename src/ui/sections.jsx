// sections.jsx — Status + headline metrics (always on top) → subsection nav → section detail.
const D = window.DATA;
const H = D.helpers;

/* ---------------- status ---------------- */
function computeStatus() {
  const fr = H.last(D.friction.total);
  const frDelta = H.delta(D.friction.total, 7);
  const cache = H.last(D.cache.hit);
  const toolErr = D.tools.mix.reduce((a, t) => a + t.count * t.errRate, 0) / D.tools.mix.reduce((a, t) => a + t.count, 0);
  const degraded = fr > 8.5 || cache < 0.6 || toolErr > 0.09;
  return { ok: !degraded, frDelta };
}

function Hero() {
  const s = computeStatus();
  const word = s.ok ? "Healthy" : "Degraded";
  return (
    <div className="hero">
      <div>
        <div className="status-label">System status</div>
        <div className="status-line">
          <span className={"status-pulse " + (s.ok ? "ok ok-bg" : "bad bad-bg")} />
          <span className="status-word">{word}</span>
        </div>
        <div className="status-reason">
          All core signals within range. <b>Friction is climbing</b> ({(s.frDelta * 100).toFixed(0)}% over 7d) and is the one metric worth watching — everything else is steady.
        </div>
      </div>
      <div className="status-meta">
        <div>last 90 days · live</div>
        <div>updated <span className="num">2 min ago</span></div>
        <div className="num" style={{ marginTop: 8, fontSize: 11, color: "var(--faint)" }}>JUN 9 2026 · 09:14 UTC</div>
      </div>
    </div>
  );
}

/* ---------------- headline metrics (clickable → route) ---------------- */
const KPI_LIST = [
  { label: "Friction rate", values: D.friction.total, fmt: "pct1", goodDir: "down", section: "friction" },
  { label: "Tokens / day", values: D.tokens.total, fmt: "tok", goodDir: null, section: "tokens" },
  { label: "Cache hit", values: D.cache.hit, fmt: "ratio", goodDir: "up", section: "cache" },
  { label: "Tools / msg", values: D.tools.perMsg, fmt: "num2", goodDir: null, section: "tools" },
  { label: "Avg turn", values: D.timing.turnDuration, fmt: "sec", goodDir: "down", section: "timing" },
  { label: "Throughput", values: D.timing.throughput, fmt: (v) => v.toFixed(0), unit: " tok/s", goodDir: "up", section: "timing" },
  { label: "Time to first token", values: D.timing.ttft, fmt: "ms", goodDir: "down", section: "timing" },
  { label: "Reasoning share", values: D.reasoning.codex, fmt: "ratio", goodDir: null, section: "reasoning" },
];

function KPI({ item, onPick }) {
  const fmtFn = typeof item.fmt === "function" ? item.fmt : FMT[item.fmt];
  const cur = H.last(item.values);
  return (
    <button className="kpi" onClick={() => onPick(item.section)}>
      <div className="k-label">{item.label}</div>
      <div className="k-value num">{fmtFn(cur)}{item.unit && <span className="unit">{item.unit}</span>}</div>
      <div className="k-foot">
        <div className="k-spark"><Spark values={item.values} color="ghost" height={30} /></div>
        <Delta values={item.values} goodDir={item.goodDir} />
      </div>
      <div className="k-more">See more <span className="arr">→</span></div>
    </button>
  );
}

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
    title: "Rate limits", blurb: "Codex 5-hour and weekly windows — where we are against reset.",
    chart: { title: "5h window usage", sub: "% of window consumed · samples toward reset", values: D.limits.windowHistory, fmt: "ratio", color: "accent", goodDir: null, now: () => (D.limits.windowUsedPct * 100).toFixed(0) + "%" },
    items: [["Current window used %", "radial gauge"], ["Burn rate", "sparkline + KPI"], ["Implied allowance estimate", "KPI"]],
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

function SectionDetail({ id }) {
  const cfg = SECTIONS[id];
  return (
    <div className="page-section">
      <div className="sd-head">
        <h2>{cfg.title}</h2>
        <p>{cfg.blurb}</p>
      </div>
      {cfg.chart && <FeaturedChart chart={cfg.chart} />}
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
