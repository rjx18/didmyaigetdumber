# Frontend — example screen elements

One dashboard screen to work out the design language. Just enough to cover the core
chart/element types; not every metric.

## Charts
- **Line chart** — friction % over time, 3 series (Total / User / Assistant)
- **Horizontal bars** — tool call mix (Read, Edit, Bash, Grep, Other)
- **Radial gauge** — 5h usage window, % used + resets-in + burn rate

## Elements
- Header — wordmark, time-range toggle (7d/30d/90d), "local · nothing uploaded" badge
- KPI cards (×4) — big number + delta chip (friction, tokens/day, cache hit, tools/msg)
- Data table — daily breakdown (date, friction, tokens, tools, sessions)
- Empty state
