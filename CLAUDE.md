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

### Data loading strategy (smart streaming)

1. **Metadata first** — read parquet footer immediately: column names, types, row count, row groups, key-value metadata. Render schema panel before any row data.
2. **Preview on load** — fetch first 500 rows via `LIMIT 500` for instant table render.
3. **Lazy pagination** — subsequent pages fetched on demand via `LIMIT/OFFSET` as user scrolls. Never load the full file unless the user explicitly requests it.

### Spatial detection (two tiers)

- **Tier 1 (GeoParquet spec):** check parquet key-value metadata for a `geo` key via `parquet_kv_metadata()`.
- **Tier 2 (column name heuristics):** scan for columns named `geometry`, `geom`, `wkb_geometry`, `wkt`, `shape`.
- **Encoding support:** WKB (BLOB column type) and WKT (VARCHAR column type).
- **CRS:** assume WGS84 if not specified. Show a warning banner if a different CRS is detected in metadata.
- **DuckDB spatial extension** loaded lazily — only when a spatial file is detected. Tabular-only users pay zero cost.

### Layout — tabular files

Full-width table. Collapsible schema sidebar on the left. SQL panel slides up from the bottom.

### Layout — spatial files

- **Default:** map takes top 65% of viewport, table panel scrolls below.
- **Resize handle** between map and table — user can drag to any split.
- **Collapse buttons:** full map, 65/35 default, full table.
- **Preference persisted** in `localStorage`.
- Call `map.resize()` whenever the panel size changes to prevent MapLibre tile seams.

### Map experience

**v1 (Phase 4–5):**
- Render points, lines, polygons — auto-styled by geometry type.
- Click feature → attribute popup (all non-geometry columns shown as key/value, geometry column shown as `[geometry]`).
- Fit map bounds to dataset bounding box on load.
- Dark map style when app is in dark mode.
- Bidirectional row ↔ feature sync (see Phase 5 spec below).

**v2 (Phase 8 — future):**
- Color-by-column (numeric and categorical).
- Size-by-value for point layers.
- Opacity slider per layer.
- Automatic legend.

### SQL interface

**v1 (Phase 6):**
- CodeMirror 6 editor, SQL syntax highlighting and autocomplete.
- Table pre-aliased as `data` — users always write `SELECT * FROM data WHERE ...`.
- Default query pre-filled: `SELECT * FROM data LIMIT 100`.
- Run via button or `Ctrl/Cmd+Enter`.
- Results replace table view with a "back to full data" breadcrumb.
- Execution time shown in ms.
- Errors shown inline with line highlighting.
- Query history: last 20 queries in `sessionStorage`, navigable with up/down arrow.

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

### Phase 3 — Paginated table view
**Deployable result:** Fully working tabular parquet explorer. Large files scroll smoothly. Column sorting works. Schema sidebar shows per-column stats on click.

Tasks:
- [ ] Install `@tanstack/react-virtual`
- [ ] Create `useTableData` hook: fetches pages via `SELECT ROW_NUMBER() OVER () AS __row_id, * FROM data LIMIT 500 OFFSET ?`
- [ ] Build `DataTable` component with `@tanstack/react-virtual` row virtualization
- [ ] Sticky column header row with sort controls (click column name → asc/desc toggle)
- [ ] Type-aware `TableCell`: numbers right-aligned, booleans as badges, nulls as muted `—`, geometry columns as `[geometry]`
- [ ] Column resize handles
- [ ] "Showing X of Y rows" counter, "Load all" button (with warning for files > 100k rows)
- [ ] Infinite scroll: detect scroll near bottom → fetch next 500 rows, append to table
- [ ] On column click in `SchemaSidebar`: run `SELECT MIN(col), MAX(col), COUNT(*) FILTER (col IS NULL), COUNT(DISTINCT col) FROM (SELECT * FROM data LIMIT 10000)` → show stats inline

**Verify before moving on:**
- Open a 1M+ row parquet file — table renders first 500 rows in < 1s
- Scrolling to the bottom triggers the next page load
- Sorting a column re-queries and re-renders correctly
- `__row_id` is present in query results but hidden from table columns displayed to user

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

### Phase 6 — SQL query panel
**Deployable result:** Write and run custom SQL against the loaded file. Results replace table view. Query history works. Errors are shown inline.

Tasks:
- [ ] Install `@codemirror/lang-sql`, `@codemirror/view`, `@codemirror/state`, `@codemirror/theme-one-dark` (or similar dark theme)
- [ ] Create `SqlEditor` component:
  - CodeMirror 6 with SQL language support
  - Autocomplete: seed with `data` table name + current schema column names
  - Dark/light theme synced with app theme
  - Default content: `SELECT * FROM data LIMIT 100`
  - `Ctrl/Cmd+Enter` keybinding to run query
  - Re-seed autocomplete when new file is loaded
- [ ] Create `SqlPanel` wrapper:
  - Slides up from bottom of screen (CSS transition, not display:none)
  - Drag handle to resize panel height
  - Toggle button in toolbar with keyboard shortcut hint (`⌘K` or similar)
  - Persist open/closed + height in `localStorage`
- [ ] Query execution:
  - Run via `useDuckDB` query helper
  - Results stored in a separate state slice (not the main table data)
  - Results feed into `DataTable` via a "query results mode" prop
  - Show row count + execution time in ms below editor
  - "Back to full data" breadcrumb/button above table when in results mode
- [ ] Error handling:
  - DuckDB errors shown inline below the editor
  - Highlight the error line in CodeMirror if line number is available
- [ ] Query history:
  - Last 20 queries in `sessionStorage`
  - Up/down arrow navigates history when editor is focused

**Verify before moving on:**
- Type `SELECT COUNT(*) FROM data` → run → result table shows 1 row with count
- Bad SQL → error appears inline, no crash
- Up arrow in editor → previous query restores
- SQL panel collapse/expand is smooth

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
