// charts.jsx — the one chart primitive: a single thin line, one baseline axis, hover popup.
const { useState, useRef, useCallback } = React;

// build an SVG path in a 1000 x H viewBox (preserveAspectRatio none keeps it responsive;
// vector-effect:non-scaling-stroke keeps the line hairline-thin at any width)
// Monotone cubic Hermite spline (Fritsch-Carlson) → cubic bézier. Smooth and passes
// through every point, but tangents are flattened at extrema so the curve never
// overshoots the data (no dips below 0, no spurious wiggle on flat/turning series).
function smoothPath(pts) {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  // secant slopes
  const dx = [], dy = [], slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    dy[i] = pts[i + 1][1] - pts[i][1];
    slope[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
  }
  // tangents
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0; // local extremum → flat tangent (prevents overshoot)
    } else {
      m[i] = (slope[i - 1] + slope[i]) / 2;
    }
  }
  // Fritsch-Carlson limiter to keep the interpolant monotone
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i][0] + dx[i] / 3;
    const c1y = pts[i][1] + (m[i] * dx[i]) / 3;
    const c2x = pts[i + 1][0] - dx[i] / 3;
    const c2y = pts[i + 1][1] - (m[i + 1] * dx[i]) / 3;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1][0].toFixed(2)},${pts[i + 1][1].toFixed(2)}`;
  }
  return d;
}

function pathFor(values, H, padY) {
  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerH = H - padY * 2;
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * 1000;
    const y = padY + (1 - (v - min) / span) * innerH;
    return [x, y];
  });
  return { d: smoothPath(pts), pts, min, max, span };
}

function pctX(i, n) { return (i / (n - 1)) * 100; }

// fmt helpers shared everywhere
const FMT = {
  pct1: (v) => v.toFixed(1) + "%",
  pct0: (v) => Math.round(v) + "%",
  ratio: (v) => (v * 100).toFixed(1) + "%",
  int: (v) => Math.round(v).toLocaleString("en-US"),
  num2: (v) => v.toFixed(2),
  sec: (v) => v.toFixed(1) + "s",
  ms: (v) => Math.round(v) + "ms",
  tok: (v) => {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
    return Math.round(v).toString();
  },
};

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// MiniLine: the workhorse.
//  values: number[]   dates: Date[]
//  fmt: key of FMT or fn   color: 'accent'|'ink'|'ghost'
//  axis: show baseline   compare: days-ago window for delta in tip   goodDir: 'up'|'down'|null
//  height px,  interactive (hover)
// harn:assume ui-chart-hover-marker-alignment ref=chart-mini-line
function MiniLine({ values, dates, fmt = "num2", color = "accent", axis = true, height = 160, compare = 7, goodDir = null, interactive = true, padY = 14 }) {
  const [hi, setHi] = useState(null);
  const ref = useRef(null);
  const fmtFn = typeof fmt === "function" ? fmt : FMT[fmt];
  const n = values.length;

  const { d } = pathFor(values, height, padY);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;

  const onMove = useCallback((e) => {
    if (!interactive || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHi(Math.round(frac * (n - 1)));
  }, [interactive, n]);

  const xPct = hi != null ? pctX(hi, n) : 0;
  // Match pathFor exactly: absolute padY within the viewBox, expressed as a % of height,
  // so the knob/guide/tooltip sit on the line at any height.
  const yPct = hi != null ? (padY + (1 - (values[hi] - min) / span) * (height - padY * 2)) / height * 100 : 0;

  // delta vs `compare` days ago (relative to hovered point)
  let deltaEl = null;
  if (hi != null && hi - compare >= 0) {
    const cur = values[hi], prev = values[hi - compare];
    const dv = prev !== 0 ? (cur - prev) / Math.abs(prev) : 0;
    const sign = dv > 0 ? "+" : "";
    let cls = "";
    if (goodDir && Math.abs(dv) > 0.002) {
      const improving = (goodDir === "up" && dv > 0) || (goodDir === "down" && dv < 0);
      cls = improving ? "g" : "b";
    }
    deltaEl = <div className={"tip-delta " + cls}>{sign}{(dv * 100).toFixed(1)}% vs {compare}d ago</div>;
  }

  // tip clamps to stay on-screen
  const tipLeft = Math.min(92, Math.max(8, xPct));

  return (
    <div className="mini" style={{ height }} ref={ref}
      onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {axis && <line className="axis" x1="0" y1={height - 0.5} x2="1000" y2={height - 0.5} />}
        <path className={"line " + color} d={d} />
      </svg>
      {hi != null && (
        <>
          <div className="guide" style={{ left: xPct + "%" }} />
          <div className={"knob " + color} style={{ left: xPct + "%", top: yPct + "%" }} />
          <div className="tip" style={{ left: tipLeft + "%", top: yPct + "%" }}>
            <div className="tip-date">{dates ? fmtDate(dates[hi]) : "#" + hi}</div>
            <div className="tip-val">{fmtFn(values[hi])}</div>
            {deltaEl}
          </div>
        </>
      )}
    </div>
  );
}
// harn:end ui-chart-hover-marker-alignment

// harn:assume ui-per-model-multiline ref=chart-multi-line
// MultiLine: one smooth line per series on a SHARED y-axis (so models compare on the
// same scale), with a color legend and a hover that lists every line's value. Stroke
// colors are set inline (per-line), overriding the .line class color.
function MultiLine({ lines, dates, fmt = "num2", height = 220, padY = 14 }) {
  const [hi, setHi] = useState(null);
  const ref = useRef(null);
  const fmtFn = typeof fmt === "function" ? fmt : FMT[fmt];
  const active = (lines || []).filter((l) => l.values && l.values.length);
  const all = active.flatMap((l) => l.values);
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;
  const span = max - min || 1;
  const n = active[0] ? active[0].values.length : 0;
  const innerH = height - padY * 2;
  const yFor = (v) => padY + (1 - (v - min) / span) * innerH;
  const pathOf = (values) => smoothPath(values.map((v, i) => [(i / (n - 1)) * 1000, yFor(v)]));

  const onMove = useCallback((e) => {
    if (!ref.current || n === 0) return;
    const r = ref.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHi(Math.round(frac * (n - 1)));
  }, [n]);

  const xPct = hi != null ? (hi / (n - 1)) * 100 : 0;
  const tipLeft = Math.min(88, Math.max(8, xPct));

  return (
    <div>
      <div className="legend">
        {active.map((l) => (
          <span className="leg" key={l.name}>
            <span className="leg-dot" style={{ background: l.color }} />{l.name}
          </span>
        ))}
      </div>
      <div className="mini" style={{ height }} ref={ref} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
        <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <line className="axis" x1="0" y1={height - 0.5} x2="1000" y2={height - 0.5} />
          {active.map((l) => <path key={l.name} className="line" style={{ stroke: l.color }} d={pathOf(l.values)} />)}
        </svg>
        {hi != null && (
          <>
            <div className="guide" style={{ left: xPct + "%" }} />
            {active.map((l) => (
              <div className="knob" key={l.name}
                style={{ left: xPct + "%", top: (yFor(l.values[hi]) / height * 100) + "%", borderColor: l.color }} />
            ))}
            <div className="tip multi" style={{ left: tipLeft + "%", top: 0 }}>
              <div className="tip-date">{dates ? fmtDate(dates[hi]) : "#" + hi}</div>
              {active.map((l) => (
                <div className="tip-row" key={l.name}>
                  <span className="leg-dot" style={{ background: l.color }} />
                  <span className="tip-name">{l.name}</span>
                  <span className="tip-val num">{fmtFn(l.values[hi])}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
// harn:end ui-per-model-multiline

// Sparkline: tiny, no axis, hover knob only (used in KPI strip)
function Spark({ values, color = "ghost", height = 30 }) {
  const { d } = pathFor(values, height, 4);
  return (
    <div className="mini" style={{ height }}>
      <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path className={"line " + color} d={d} />
      </svg>
    </div>
  );
}

// delta badge for KPIs
function Delta({ values, window: w = 7, goodDir = null }) {
  const cur = values[values.length - 1];
  const prev = values[values.length - 1 - w];
  const dv = prev !== 0 ? (cur - prev) / Math.abs(prev) : 0;
  const arrow = dv > 0.001 ? "↑" : dv < -0.001 ? "↓" : "→";
  let cls = "flat";
  if (goodDir && Math.abs(dv) > 0.002) {
    const dir = dv > 0 ? "up" : "down";
    const improving = dir === goodDir;
    cls = (dir + "-" + (improving ? "good" : "bad"));
  }
  const sign = dv > 0 ? "+" : "";
  return <span className={"delta " + cls}>{arrow} {sign}{(dv * 100).toFixed(1)}%</span>;
}

// horizontal bar list
function HBars({ rows, max, fmt = "int", colorFor }) {
  const m = max || Math.max(...rows.map((r) => r.value));
  const fmtFn = typeof fmt === "function" ? fmt : FMT[fmt];
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div className="hbar" key={i}>
          <div className="hb-name">{r.name}</div>
          <div className="hb-track">
            <div className="hb-fill" style={{ width: (r.value / m * 100) + "%", background: colorFor ? colorFor(r) : undefined }} />
          </div>
          <div className="hb-val">{r.label != null ? r.label : fmtFn(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { MiniLine, MultiLine, Spark, Delta, HBars, FMT, fmtDate });
