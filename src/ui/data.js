/* Synthetic but plausible AI-metrics data. Deterministic (seeded) so it never jumps around. */
(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20260608);
  const N = 90; // days

  // dates ending today
  const days = [];
  const today = new Date(2026, 5, 8); // Jun 8 2026
  for (let i = N - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }

  // generic series: base value, slow drift, weekly seasonality, noise. clamp optional.
  function series(opts) {
    const { base, drift = 0, season = 0, noise = 0.05, min = -Infinity, max = Infinity, round = null } = opts;
    const out = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const dow = days[i].getDay();
      const weekend = (dow === 0 || dow === 6) ? -1 : 1;
      let v = base * (1 + drift * t);
      v += base * season * weekend * 0.5;
      v += base * (rnd() - 0.5) * 2 * noise;
      v = Math.min(max, Math.max(min, v));
      if (round === 'int') v = Math.round(v);
      else if (round === 'k') v = Math.round(v / 100) * 100;
      else v = Math.round(v * 1000) / 1000;
      out.push(v);
    }
    return out;
  }

  // Friction (%) — trending slightly UP recently (gives a story for "degraded" if you want)
  const frictionTotal = series({ base: 6.2, drift: 0.18, season: 0.12, noise: 0.14, min: 1.5, max: 14 });
  const frictionUser = series({ base: 3.4, drift: 0.22, season: 0.1, noise: 0.16, min: 0.8, max: 9 });
  const frictionAssistant = series({ base: 2.8, drift: 0.10, season: 0.08, noise: 0.18, min: 0.5, max: 8 });

  const friction1pt = series({ base: 4.1, drift: 0.12, season: 0.1, noise: 0.15, min: 1, max: 9 });
  const friction2pt = series({ base: 2.1, drift: 0.30, season: 0.12, noise: 0.2, min: 0.3, max: 7 });

  // Activity
  const sessions = series({ base: 1420, drift: 0.35, season: 0.30, noise: 0.10, min: 200, round: 'int' });
  const turns = sessions.map((s, i) => Math.round(s * (7.5 + (rnd() - 0.5))));
  const messages = turns.map((t) => Math.round(t * (2.05 + (rnd() - 0.45) * 0.3)));
  const userMsgs = messages.map((m) => Math.round(m * 0.49));
  const asstMsgs = messages.map((m, i) => m - userMsgs[i]);
  const interrupts = series({ base: 64, drift: 0.5, season: 0.2, noise: 0.35, min: 5, round: 'int' });
  const retries = series({ base: 38, drift: 0.4, season: 0.2, noise: 0.4, min: 3, round: 'int' });
  const compactions = series({ base: 7, drift: 0.3, season: 0.1, noise: 0.6, min: 0, round: 'int' });

  // Tokens (per day, total)
  const tokensTotal = series({ base: 48e6, drift: 0.55, season: 0.28, noise: 0.12, min: 5e6, round: 'int' });
  // composition fractions
  const comp = {
    input: tokensTotal.map((v) => Math.round(v * 0.14)),
    output: tokensTotal.map((v) => Math.round(v * 0.11)),
    cacheRead: tokensTotal.map((v) => Math.round(v * 0.52)),
    cacheCreate: tokensTotal.map((v) => Math.round(v * 0.14)),
    reasoning: tokensTotal.map((v) => Math.round(v * 0.09)),
  };
  const tokensPerSession = tokensTotal.map((v, i) => Math.round(v / sessions[i]));

  // Cache
  const cacheHit = series({ base: 0.78, drift: 0.06, season: 0.02, noise: 0.04, min: 0.5, max: 0.95 });

  // Reasoning / thinking
  const reasoningShare = series({ base: 0.094, drift: 0.15, season: 0.03, noise: 0.08, min: 0.02, max: 0.2 });
  const thinkingShare = series({ base: 0.072, drift: 0.18, season: 0.03, noise: 0.1, min: 0.02, max: 0.2 });

  // Tools
  const toolsPerMsg = series({ base: 1.34, drift: 0.12, season: 0.05, noise: 0.07, min: 0.6, max: 2.4 });
  const toolMix = [
    { name: 'read_file', count: 31840, errRate: 0.006, outChars: 12.4e6 },
    { name: 'edit_file', count: 21210, errRate: 0.021, outChars: 3.1e6 },
    { name: 'run_shell', count: 18750, errRate: 0.084, outChars: 22.7e6 },
    { name: 'grep', count: 14320, errRate: 0.004, outChars: 8.9e6 },
    { name: 'web_search', count: 9610, errRate: 0.038, outChars: 5.4e6 },
    { name: 'list_files', count: 8270, errRate: 0.002, outChars: 2.2e6 },
    { name: 'write_file', count: 6980, errRate: 0.014, outChars: 0.9e6 },
    { name: 'apply_patch', count: 5410, errRate: 0.112, outChars: 1.3e6 },
  ];

  // Models
  const models = [
    { name: 'claude-sonnet-4.5', tokens: 1.92e9 },
    { name: 'gpt-5-codex', tokens: 1.34e9 },
    { name: 'claude-opus-4.1', tokens: 0.71e9 },
    { name: 'gpt-5-mini', tokens: 0.38e9 },
  ];

  // Timing / latency
  const turnDuration = series({ base: 11.8, drift: 0.14, season: 0.06, noise: 0.1, min: 4, max: 26 }); // sec
  const ttft = series({ base: 640, drift: 0.2, season: 0.05, noise: 0.12, min: 280, max: 1600, round: 'int' }); // ms
  const throughput = series({ base: 78, drift: -0.05, season: 0.04, noise: 0.08, min: 30, max: 130 }); // tok/s
  const toolLatency = series({ base: 410, drift: 0.16, season: 0.06, noise: 0.14, min: 120, max: 1400, round: 'int' }); // ms

  // Rate-limit window (Codex 5h)
  const windowUsedPct = 0.71;
  const burnRate = 1.86e6; // tokens/hr
  const windowHistory = (function () {
    // last 5h, 30 samples climbing toward reset
    const arr = [];
    for (let i = 0; i < 30; i++) {
      const t = i / 29;
      arr.push(Math.min(0.95, t * 0.71 + (rnd() - 0.5) * 0.03));
    }
    return arr;
  })();
  const weeklyUsedPct = 0.43;

  // delta helper: compare last value to value `w` days ago
  function delta(arr, w = 7) {
    const a = arr[arr.length - 1];
    const b = arr[arr.length - 1 - w];
    if (b === 0) return 0;
    return (a - b) / Math.abs(b);
  }
  const last = (arr) => arr[arr.length - 1];

  window.DATA = {
    N, days,
    friction: { total: frictionTotal, user: frictionUser, assistant: frictionAssistant, t1: friction1pt, t2: friction2pt },
    activity: { sessions, turns, messages, userMsgs, asstMsgs, interrupts, retries, compactions },
    tokens: { total: tokensTotal, comp, perSession: tokensPerSession },
    cache: { hit: cacheHit },
    reasoning: { codex: reasoningShare, claude: thinkingShare },
    tools: { perMsg: toolsPerMsg, mix: toolMix },
    models,
    timing: { turnDuration, ttft, throughput, toolLatency },
    limits: { windowUsedPct, weeklyUsedPct, burnRate, windowHistory },
    helpers: { delta, last },
  };
})();
