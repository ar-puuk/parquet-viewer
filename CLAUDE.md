# CLAUDE.md — Parquet Explorer

This file is the single source of truth for the Parquet Explorer project. Read it fully at the start of every chat session before writing any code. It contains the product spec, technical decisions, and phased implementation plan. Always check which phase has been completed before starting work.

---

## Project overview

A browser-based, zero-backend parquet and geoparquet file viewer hosted on GitHub Pages (public repo). Users can preview tabular and spatial parquet files from their local machine or a public S3/HTTP URL. No server, no authentication backend, no data leaves the browser.

**Core constraint:** Everything runs in the browser. DuckDB-WASM is the query engine. MapLibre GL JS handles maps. The app is a static site deployed to GitHub Pages via GitHub Actions.

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS v3 (`dark:` class strategy) |
| Query engine | `@duckdb/duckdb-wasm` |
| Maps | `maplibre-gl` |
| Map tiles | OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`) |
| Table virtualization | `@tanstack/react-virtual` |
| SQL editor | CodeMirror 6 (`@codemirror/lang-sql`) |
| State management | Zustand (lightweight, avoids prop-drilling for shared hover/select state) |
| Routing | React Router (hash-based — required for GitHub Pages) |
| Deployment | GitHub Pages via GitHub Actions |
| CI trigger | Push to `main` branch |

---

## Product spec

### File loading

Three methods, all supported from day one (Phases 1–2):

1. **Local file** — full-page drag-and-drop zone + file picker button. File read via browser File API, passed to DuckDB via `registerFileBuffer`. Never uploaded anywhere.
2. **S3 URL** — accepts both `s3://bucket/key` and `https://bucket.s3.amazonaws.com/key` forms. Normalize `s3://` to virtual-hosted-style HTTPS. Public buckets only — no credentials. DuckDB handles HTTP range requests natively so only needed row groups are fetched.
3. **Public HTTP/HTTPS URL** — paste any publicly accessible URL. Same DuckDB range request behavior.

### Data loading strategy (query-first)

1. **Metadata first** — read parquet footer immediately: column names, types, row count, row groups, key-value metadata. Render schema panel before any row data.
2. **Auto-run default query** — immediately after metadata loads, auto-execute `SELECT * FROM data LIMIT 1000` (BLOB columns auto-excluded via `EXCLUDE`). Table and map populate from this result.
3. **User-driven queries** — the SQL panel is always visible. Users edit and re-run queries; each run replaces the current result. No pagination — the LIMIT in the SQL controls row count.
4. **No background prefetch** — data is only fetched when a query runs. The schema sidebar shows counts and stats from parquet metadata alone.

### Spatial detection (two tiers)

- **Tier 1 (GeoParquet spec):** check parquet key-value metadata for a `geo` key via `parquet_kv_metadata()`. Also extracts `bbox` for immediate map viewport fit.
- **Tier 2 (column name heuristics):** scan for columns named `geometry`, `geom`, `wkb_geometry`, `wkt`, `shape`.
- **Encoding support:** WKB (BLOB column type) and WKT (VARCHAR column type).
- **CRS:** assume WGS84 if not specified. Show a warning banner if a different CRS is detected in metadata.
- **DuckDB spatial extension** loaded lazily — only when a spatial file is detected. Tabular-only users pay zero cost.

### Layout states

Five distinct states based on file type and query status:

**State 1 — No file:** Drop zone (full screen).

**State 2 — Spatial file, no query run yet:**
- Schema sidebar (left) + SQL panel (open, default query) + Map (right, fit to metadata bbox, no features).

**State 3 — Spatial file, query has run:**
- Schema sidebar + SQL panel (collapsed to 1-line bar) + SplitLayout: Map (features from query, 65%) / Results table (35%).

**State 4 — Tabular file, no query run yet:**
- Schema sidebar + SQL panel (open, default query) + "Run the query above to load data" empty state.

**State 5 — Tabular file, query has run:**
- Schema sidebar + SQL panel (collapsed) + Results table (full height).

### Map experience

**v1 (current):**
- Map only shown for spatial files.
- On file load: map fits to `bbox` from GeoParquet metadata (instant, no data query). No features shown yet.
- After query runs: companion geo query runs in parallel, features appear on map.
- Companion geo strategy: if geometry column is in query result, wrap the user's SQL; otherwise re-query base table with same LIMIT.
- Render points, lines, polygons — auto-styled by geometry type.
- Click feature → attribute popup (all non-geometry columns shown as key/value).
- Dark map style when app is in dark mode.
- Bidirectional row ↔ feature sync (Phase 5).

**v2 (Phase 8 — future):**
- Color-by-column (numeric and categorical).
- Size-by-value for point layers.
- Opacity slider per layer.
- Automatic legend.

### SQL interface (implemented in Phase 3+6 merge)

- CodeMirror 6 editor, SQL syntax highlighting.
- Table pre-aliased as `data` — users always write `SELECT * FROM data WHERE ...`.
- Default query auto-generated from schema: `SELECT * [EXCLUDE (blob_cols)] FROM data LIMIT 1000`.
- Auto-runs on file load; user can edit and re-run at any time.
- Run via button or `Ctrl/Cmd+Enter`.
- Results replace current table + map.
- Execution time shown in ms.
- Errors shown inline below editor.
- SQL panel collapses to 1-line bar after first run; "Edit" button re-expands it.
- Query history (Phase 7 — future): last 20 queries in `sessionStorage`.

**v2 (Phase 7 — future):**
- Visual query builder: column select, filter rows, sort, limit, group-by + aggregate.
- Each builder action updates the SQL panel in real time (full transparency).
- User can edit generated SQL directly.
- "Copy SQL" button.

### Schema & metadata panel

Shown immediately after file load (before any row data):
- Per column: name, data type, nullable badge.
- On column click: min, max, null count, distinct count (sampled via `LIMIT 10000`), inline mini stat bar.
- File-level strip: row count, column count, file size, parquet version, row group count.
- Geo metadata (if spatial): geometry column name, CRS, geometry types, bounding box.

### Theme

System default with manual override toggle (light / dark). Preference stored in `localStorage`. Tailwind `dark:` class strategy — add/remove `dark` class on `<html>`.

---

## Key technical decisions (rationale included for future Claude sessions)

### `__row_id` synthetic column
Every query that feeds the table adds `ROW_NUMBER() OVER () AS __row_id`. This is the stable identifier used to link map features to table rows (bidirectional sync). Added in Phase 3, relied on in Phase 5. Never shown to the user in the table UI.

### DuckDB-WASM singleton
Initialize once on app startup, expose via a `useDuckDB()` hook. The hook returns `{ db, conn, query, loading, error }`. All components share the same connection. Never re-initialize between file loads — just re-register the file.

### S3 URL normalization
```
s3://bucket/key  →  https://bucket.s3.amazonaws.com/key
```
Also handle path-style as fallback: `https://s3.amazonaws.com/bucket/key`. Detect by checking if the input starts with `s3://`.

### MapLibre + React
MapLibre manages its own DOM. Wrap it in a component that uses a `ref` for the container div and calls `new Map({ container: ref.current, ... })` in a `useEffect`. Never let React re-render destroy the map instance — keep it in a ref, not in state.

### Hash-based routing
GitHub Pages does not support server-side routing. Use React Router with `HashRouter`. All routes are `/#/...`.

### Vite base path
Set `base` in `vite.config.ts` to the repo name: `base: '/your-repo-name/'`. This must match the GitHub Pages URL.

### GitHub Actions deploy
```yaml
- run: npm ci
- run: npm run build
- uses: peaceiris/actions-gh-pages@v3
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./dist
```

### CodeMirror autocomplete
Seed the SQL autocomplete with `data` as the table name and all column names from the current schema. Re-seed whenever a new file is loaded.

### OpenFreeMap tile styles
- Light: `https://tiles.openfreemap.org/styles/liberty`
- Dark: `https://tiles.openfreemap.org/styles/dark` (or use `liberty` with MapLibre's built-in dark override)

---

## File structure

```
parquet-explorer/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Build + deploy to GitHub Pages
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx        # Top nav, theme toggle, layout wrapper
│   │   │   ├── SchemaSidebar.tsx   # Collapsible column list + stats
│   │   │   └── SplitLayout.tsx     # Resizable map/table split for spatial files
│   │   ├── loader/
│   │   │   ├── DropZone.tsx        # Drag-and-drop landing page
│   │   │   └── UrlInput.tsx        # HTTP/S3 URL input bar
│   │   ├── table/
│   │   │   ├── DataTable.tsx       # Virtualized table (tanstack-virtual)
│   │   │   └── TableCell.tsx       # Type-aware cell renderer
│   │   ├── map/
│   │   │   ├── MapView.tsx         # MapLibre GL wrapper (ref-based)
│   │   │   ├── FeaturePopup.tsx    # Click popup with attribute k/v table
│   │   │   └── LayerManager.tsx    # Add/update GeoJSON layers by geometry type
│   │   └── sql/
│   │       ├── SqlPanel.tsx        # Collapsible panel wrapper
│   │       └── SqlEditor.tsx       # CodeMirror 6 editor component
│   ├── hooks/
│   │   ├── useDuckDB.ts            # Singleton DuckDB-WASM init + query runner
│   │   ├── useParquetFile.ts       # File registration, schema extraction, geo detection
│   │   ├── useTableData.ts         # Paginated row fetching with __row_id
│   │   └── useGeoData.ts           # Geometry fetch, WKB/WKT decode, GeoJSON build
│   ├── store/
│   │   └── useAppStore.ts          # Zustand store: hoveredRowId, selectedRowId, theme, splitRatio
│   ├── utils/
│   │   ├── s3url.ts                # S3 URL normalization
│   │   ├── geoDetect.ts            # Geo detection logic (kv metadata + column name heuristics)
│   │   └── formatters.ts           # Cell value formatters (null, boolean, number, geometry)
│   ├── types/
│   │   └── index.ts                # Shared TypeScript types
│   ├── App.tsx
│   └── main.tsx
├── CLAUDE.md                       # This file
├── index.html
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

---

## Implementation phases

Each phase ends with a deployable checkpoint. Always confirm which phase is complete before starting the next. Ask the user: "Which phase are we starting from?" at the beginning of each session if it isn't stated.

---

### Phase 1 — Project foundation
**Deployable result:** App shell live on GitHub Pages. Dark mode toggle works. Landing page shows drop zone UI (non-functional). CI pipeline confirmed working.

Tasks:
- [ ] Init repo: `npm create vite@latest parquet-explorer -- --template react-ts`
- [ ] Install and configure Tailwind CSS v3
- [ ] Set `base` in `vite.config.ts` to repo name
- [ ] Create GitHub Actions workflow (`deploy.yml`) — build on push to `main`, deploy to `gh-pages`
- [ ] Build `AppShell` component: top nav, app name, GitHub link, theme toggle button
- [ ] Implement theme toggle: reads `localStorage`, falls back to `prefers-color-scheme`, writes `dark` class to `<html>`
- [ ] Create landing / empty state with placeholder drop zone (styled, not functional)
- [ ] Set up React Router with `HashRouter`
- [ ] Add global error boundary with user-friendly fallback UI
- [ ] Add ESLint + Prettier config

**Verify before moving on:**
- GitHub Actions runs and deploys successfully
- App loads at `https://username.github.io/repo-name/`
- Dark mode toggle persists across refresh

---

### Phase 2 — DuckDB-WASM + file loading
**Deployable result:** Load a local parquet file or paste a public URL → schema panel and file stats appear instantly. S3 URL normalization works.

Tasks:
- [ ] Install `@duckdb/duckdb-wasm`
- [ ] Create `useDuckDB` hook — singleton init, `query()` helper, loading/error state
- [ ] Show DuckDB init progress on landing page (WASM can take 1–2s to initialize)
- [ ] Implement `DropZone` component — full-page drag-and-drop, file picker fallback, accept `.parquet`
- [ ] On file drop: `registerFileBuffer`, set active file in Zustand store
- [ ] Implement `UrlInput` component — text input, validate URL format, submit on Enter
- [ ] S3 URL normalization in `src/utils/s3url.ts`
- [ ] On URL submit: `registerFileURL`, set active file in store
- [ ] Read schema: `DESCRIBE SELECT * FROM data LIMIT 0` → column list
- [ ] Read file stats: `SELECT COUNT(*) FROM data` + `parquet_file_metadata('data')` for row groups, version
- [ ] Build `SchemaSidebar`: column name, type badge, nullable indicator, file stats strip at top
- [ ] Handle CORS errors with a specific, actionable error message

**Verify before moving on:**
- Local `.parquet` file → schema sidebar renders immediately
- Public HTTPS parquet URL → same result
- `s3://` URL → normalized correctly, loads if bucket is public
- CORS error shows a clear message, not a generic crash

---

### Phase 3 — SQL panel + query-driven table *(merged with old Phase 6)*
**Deployable result:** Load any parquet file → schema appears, default query auto-runs, results appear in table. User can edit SQL and re-run. Spatial files show map with features from query result.

Architecture: **query-first** — no data is fetched until a query runs. The SQL panel is always visible. Results live in `queryResult` Zustand state; both DataTable and MapView read from it.

Tasks:
- [x] Install `@tanstack/react-virtual`, `codemirror`, `@codemirror/lang-sql`, `@codemirror/theme-one-dark`
- [x] Add `queryResult: QueryResult | null` to Zustand store; clear on file unload
- [x] Create `useSqlQuery` hook: runs SQL via `queryDBWithColumns`, wraps query with `ROW_NUMBER() OVER ()` to inject `__row_id`, stores result in store
- [x] Create `SqlEditor` component: CodeMirror 6, SQL syntax highlighting, `Ctrl/Cmd+Enter` keybinding, dark/light theme sync
- [x] Create `SqlPanel` component:
  - Generates schema-aware default query (excludes BLOB columns via `EXCLUDE`)
  - Auto-runs default query on file load
  - Expanded state: editor + Run button + inline error
  - Collapsed state: 1-line query preview + row count + execution time + "Edit" button
- [x] Rewrite `DataTable`: reads from `queryResult` store slice, no own fetching, no pagination, virtualised over result rows
- [x] `useGeoData` rewritten: watches `queryResult`, runs companion geo query, wraps user SQL if geometry column present
- [x] `GeoInfo` extended with optional `bbox` field (parsed from GeoParquet metadata)
- [x] `MapView` fits to metadata bbox on load; re-fits to feature bounds after first query
- [x] Five-state layout in `App.tsx` (see "Layout states" section above)

**Verify before moving on:**
- Load tabular file → schema appears, default query auto-runs, table shows 1000 rows
- Load spatial file → map appears immediately fit to bbox, then features populate
- Edit SQL and re-run → results replace previous table + map
- Bad SQL → error shown inline, no crash
- `__row_id` present in results but hidden from table display

---

### Phase 4 — Spatial detection + map view
**Deployable result:** Open a GeoParquet file → map renders with geometries, table shows attributes below. Split layout with drag handle. Feature popup on map click. Both WKB and WKT files work. Column-name fallback detection works.

Tasks:
- [ ] Create `src/utils/geoDetect.ts`:
  - Query `parquet_kv_metadata('data')` and check for `geo` key
  - Fallback: scan schema columns for known geometry column names
  - Detect encoding (WKB = BLOB type, WKT = VARCHAR)
  - Parse CRS from `geo` metadata if present
- [ ] Load DuckDB spatial extension on demand: `LOAD spatial` (only when geo file detected)
- [ ] Create `useGeoData` hook:
  - Batch-fetch geometry + `__row_id` in chunks of 1000
  - Convert via `ST_AsGeoJSON(ST_GeomFromWKB(col))` or `ST_AsGeoJSON(ST_GeomFromText(col))`
  - Build GeoJSON FeatureCollection with `__row_id` as feature property
- [ ] Install `maplibre-gl`
- [ ] Create `MapView` component:
  - Ref-based container div, init `new maplibregl.Map()` in `useEffect`
  - Connect OpenFreeMap liberty style
  - Switch to dark style variant when app is in dark mode
  - Fit bounds to data bounding box on load
  - Call `map.resize()` on container size change
- [ ] Create `LayerManager`:
  - Add GeoJSON source from `useGeoData` result
  - Auto-detect geometry type(s), add appropriate layers (`circle` / `line` / `fill` + outline)
  - Default styles: semi-transparent fill, colored stroke
- [ ] Create `FeaturePopup`: MapLibre popup, shows all non-geometry properties as k/v table, "Scroll to row" button
- [ ] Create `SplitLayout` component:
  - Default: 65% map, 35% table
  - Drag handle between panels, updates split ratio
  - Collapse buttons: full map (`100/0`), default (`65/35`), full table (`0/100`)
  - Persist ratio in `localStorage`
- [ ] Show CRS warning banner if non-WGS84 CRS detected

**Verify before moving on:**
- GeoParquet (official `geo` metadata) file renders on map
- WKT-based spatial file renders via column name detection
- Drag handle resizes panels, `map.resize()` prevents tile seams
- Click a map feature → popup with attributes appears
- Collapse buttons work correctly
- Dark mode switches map style

---

### Phase 5 — Map ↔ table sync
**Deployable result:** Hover a table row → feature highlights on map. Hover a map feature → table row highlights. Click either → full selection with scroll-to behavior.

Tasks:
- [ ] Add `hoveredRowId: number | null` and `selectedRowId: number | null` to Zustand store
- [ ] Table row `onMouseEnter` → set `hoveredRowId` → MapLibre `setFeatureState(__row_id, { hover: true })`
- [ ] MapLibre `mousemove` on layers → set `hoveredRowId` → table virtual scroller `scrollToIndex`
- [ ] Update MapLibre layer paint to use feature-state for highlight color
- [ ] Table row `onClick` → set `selectedRowId` → `map.flyTo()` feature centroid, open popup
- [ ] Map feature `click` → set `selectedRowId` → table `scrollToIndex`, highlight row
- [ ] "Scroll to row" button inside popup → `scrollToIndex` in table
- [ ] Geometry column excluded from popup display (shown as `[geometry]`)

**Verify before moving on:**
- Hover table row → correct feature highlights on map (no lag, no wrong feature)
- Hover map feature → table row highlights and scrolls into view
- Click map feature → table scrolls to correct row
- Click table row → map flies to feature, popup opens

---

### Phase 6 — SQL enhancements *(core SQL panel done in Phase 3)*
**Deployable result:** SQL autocomplete seeded from schema. Query history navigable with up/down arrow.

Tasks:
- [ ] Autocomplete: seed CodeMirror SQL extension with `data` table name + current schema column names; re-seed on new file load
- [ ] Query history: last 20 queries in `sessionStorage`; up/down arrow in editor navigates history
- [ ] Resizable SQL panel height (drag handle on bottom edge)
- [ ] Persist panel open/closed state and height in `localStorage`

**Verify before moving on:**
- Type `sel` in editor → `SELECT` autocomplete suggestion appears
- Type column name prefix → matching column names suggested
- Run a query, then press up arrow → previous query restores
- Resize SQL panel, reload page → height persists

---

### Phase 7 — Visual query builder *(future)*
**Deployable result:** UI controls to build queries without writing SQL. Generated SQL shown in panel. Both modes interoperate.

Tasks:
- [ ] Column selector: checkbox list → generates `SELECT col1, col2 FROM data`
- [ ] Filter builder: add filter rows (column dropdown + operator dropdown + value input) → generates `WHERE` clause
- [ ] Sort controls: column + ASC/DESC → generates `ORDER BY`
- [ ] Limit control: number input → generates `LIMIT`
- [ ] Aggregate panel: group-by column + aggregate function (COUNT, SUM, AVG, MIN, MAX)
- [ ] Each builder action updates SQL panel in real time
- [ ] "Copy SQL" button
- [ ] Best-effort: parse simple SQL back to builder state when user edits SQL directly

---

### Phase 8 — Map styling & export *(future)*
**Deployable result:** Color map features by a column value. Export results as CSV. Share a URL that pre-loads a remote file.

Tasks:
- [ ] Color-by-column: column picker → MapLibre paint expression → automatic legend
- [ ] Size-by-column for point layers: column picker → `circle-radius` expression
- [ ] Opacity slider per layer type
- [ ] Export query results to CSV (client-side Blob download)
- [ ] Export current map view as PNG via `map.getCanvas().toDataURL()`
- [ ] Shareable URL: encode remote file URL as a query param (`#/?url=https://...`), parse on load and auto-open

---

## Session handoff protocol

At the start of every new chat session, state which phase you are working on. If unsure, say so and Claude will ask clarifying questions before writing any code.

Example prompt to start a new session:
> "We are working on Parquet Explorer. Please read CLAUDE.md. We have completed Phases 1–3. Start Phase 4."

Claude should:
1. Acknowledge the completed phases
2. Confirm the deployable goal for the current phase
3. List the tasks for the phase and ask if any should be skipped or modified
4. Implement tasks one at a time, asking for confirmation between major tasks if the phase is large

---

## Conventions

- All components in `.tsx`, all hooks in `.ts`
- Hook names start with `use`
- Zustand store in `src/store/useAppStore.ts` — single store, sliced by concern
- Tailwind only for styling — no CSS modules, no styled-components
- Never hardcode the parquet file path — always use the `data` alias registered with DuckDB
- `__row_id` is always present in queries that feed the table — never remove it
- Keep DuckDB queries in hook files, not in components
- MapLibre instance lives in a ref in `MapView.tsx` — never passed as a prop or stored in Zustand
