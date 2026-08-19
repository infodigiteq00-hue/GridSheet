# Gridsheet — Excel to Dashboard SaaS

Turn a spreadsheet into a fully customizable dashboard. Upload an `.xlsx`/`.xls`/`.csv`
file, get an AI-drafted first layout, then tweak every tile's chart type, data mapping,
size, palette, and typography — drag to reorder, drag a corner to resize, publish a
shareable read-only view.

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript**
- **Tailwind CSS v4** for styling
- **Zustand** (with `localStorage` persistence) for app state — dataset, dashboard, selection
- **SheetJS (`xlsx`)** for real, in-browser spreadsheet parsing (installed from the
  official SheetJS CDN tarball, since the npm registry build is unpatched — see
  `package.json`)
- **OpenAI-compatible LLM** (optional — OpenAI or OpenRouter) for AI-drafted dashboard
  layouts, called from a server route

All chart/table/KPI tiles (bar, line, area, donut, KPI stat, table, pivot table, text
block, heatmap, scatter, gauge, category grid) are hand-built with SVG/CSS — no charting
library — so every visual detail (colors, radii, type scale) is fully under our control.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Enabling AI-drafted layouts (optional)

By default, the "Build my dashboard" step in `/upload` uses a built-in heuristic to pick
chart types/groupings/titles from your columns — no API key required, the app is fully
functional without it.

To have a model draft the first layout instead (it picks better chart choices, writes
titles, and can write short insight text for "text block" tiles), copy `.env.example` to
`.env.local` and set your key:

```bash
cp .env.example .env.local
# then edit .env.local
```

Any OpenAI-compatible provider works, because `OPENAI_BASE_URL` re-points the official
`openai` client. Against OpenAI itself, just set the key:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini        # optional, this is the default
```

Against [OpenRouter](https://openrouter.ai), add the base URL and a namespaced model
slug:

```bash
OPENAI_API_KEY=sk-or-v1-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=openai/gpt-5.6-luna   # optional, this is the default for OpenRouter
```

Two optional extras: `OPENAI_MAX_TOKENS` (default 4000) caps response length — reasoning
models like the GPT-5.x family otherwise request their full output ceiling, which
providers reject when the account balance can't cover it — and `OPENAI_APP_URL` sets the
`HTTP-Referer` that OpenRouter uses to attribute requests to your app.

Whichever model you choose should support JSON output, since the auto-layout and
"Describe a tile" features expect parseable JSON back; responses wrapped in prose or a
markdown fence are still recovered, and anything unparseable falls back to the heuristic.

Restart the dev server after adding the key. If the key is missing, invalid, or the
request fails for any reason, the app automatically falls back to the heuristic layout —
uploading and building a dashboard always works.

## How it works

1. **Upload** (`/upload`) — drop a spreadsheet (or use the built-in sample workbook), or
   switch to the **"Link a spreadsheet"** tab and paste a Google Sheets share link (shared
   as "Anyone with the link") or a direct URL to a public `.csv`/`.xlsx` file. Linked
   sheets are fetched and parsed server-side (via `/api/import-link`, which converts a
   Google Sheets URL into its CSV export endpoint) to avoid browser CORS issues. Either
   way, columns are typed (text / number / date) and given a default role (Group /
   Measure / Skip) using simple heuristics (numeric → measure, low-cardinality text/date
   → group, id-like or high-cardinality text → skip). You can override any column's role
   before building.
2. **Build** — clicking "Build my dashboard" posts the column metadata to
   `/api/ai/auto-layout`. If `OPENAI_API_KEY` is set, the configured model returns a JSON
   layout (validated and sanitized against your actual columns before use); otherwise a
   deterministic heuristic produces a sensible first draft server-side.
3. **Builder** (`/builder`) — a 12-column grid canvas. Add tiles from the left palette,
   click a tile to select it, and use the right inspector to change its chart type, the
   dimension/measure it reads, sort order, top-N, width (in twelfths) and height, color
   palette, and type scale/font. Drag a tile's header to reorder, drag its bottom-right
   corner to resize.
4. **Templates** (`/templates`) — starting arrangements (Full overview, KPI wall, Tables
   first, Exec one-pager) generated generically from whatever columns are available.
5. **Published** (`/published`) — a clean, read-only rendering of the current dashboard
   with a fake shareable link, meant to represent what an end viewer would see.

State (the parsed dataset and the dashboard/widgets) is persisted to `localStorage` via
Zustand, so it survives page reloads and navigation between screens in this prototype.

### Live sync from a spreadsheet link

Once a dataset was imported from a link, the **Builder** (and **Published**) header shows
a live-sync bar: a "Live"/"synced Xs ago" indicator, a **Refresh now** button, an
**Auto every** toggle with an interval picker (15s / 30s / 1m / 5m), and **Stop syncing**
to detach the source and freeze the data. Auto-refresh polls `/api/import-link` again on
the same URL and merges the fresh rows in, re-inferring any new columns while preserving
the Group/Measure/Skip role you already chose for columns that still exist — so widgets
and layout don't get reset on every refresh. This is polling-based (not push/websocket),
which matches how linked Google Sheets/CSV sources are typically kept "live" in BI tools.

## Project structure

```
src/
  app/
    page.tsx                  Landing page
    upload/page.tsx           Upload + column mapping
    templates/page.tsx        Template gallery
    builder/page.tsx          Builder shell (palette + canvas + inspector)
    published/page.tsx        Read-only published view
    api/ai/auto-layout/       Server route: OpenAI layout draft + heuristic fallback
    api/import-link/          Server route: fetch + parse a linked spreadsheet URL
  components/
    AppHeader.tsx              Shared top nav
    SyncStatus.tsx              Live-sync status bar (refresh, auto-refresh, stop syncing)
    builder/                   Palette, Canvas (drag/resize), Inspector
    widgets/                   One renderer per chart/tile type + dispatcher
    icons/TypeIcon.tsx         Chart-type icon set
  lib/
    types.ts                   Widget/Dataset/Column types
    store.ts                   Zustand store
    parseFile.ts                SheetJS-based spreadsheet parsing (file + shared buffer)
    linkSource.ts                Normalizes a pasted URL (Google Sheets → CSV export, etc.)
    useAutoRefresh.ts            Polling hook for live-synced datasets
    inferColumns.ts             Column type/role inference heuristics + merge-on-refresh
    aggregate.ts                Group-by, pivot, totals, trend, scatter helpers
    heuristicLayout.ts          Deterministic first-draft layout generator
    aiLayout.ts                 AI response schema + validation/sanitization
    palettes.ts, format.ts, sampleData.ts
```

## Notes / next steps for a production SaaS

This is a complete, working single-tenant prototype. To take it further you'd likely add:

- Authentication + per-user/team storage (a database instead of `localStorage`) so
  dashboards and uploaded files persist server-side and can be shared for real
- Real shareable published links (currently `/published` just renders the current
  in-browser dashboard state)
- File size/row limits and background parsing for very large spreadsheets
- Billing/plan limits if this becomes a metered product
