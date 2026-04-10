# Parquet Explorer

A browser-based, zero-backend Parquet and GeoParquet file viewer. No server, no uploads — everything runs locally in your browser using DuckDB-WASM.

**Live app:** https://ar-puuk.github.io/parquet-viewer/

---

## Features

### File loading
- **Local file** — drag-and-drop onto the landing page or click to browse. The file never leaves your machine.
- **HTTP/HTTPS URL** — paste any publicly accessible Parquet URL.
- **S3 URL** — paste `s3://bucket/key` (normalized to virtual-hosted HTTPS). Public buckets only; no credentials required. DuckDB fetches only the row groups it needs via HTTP range requests.

### Schema & metadata sidebar (right panel)
Appears instantly after file load, before any row data is fetched:
- Per-column: name, data type, nullable badge
- Click a column to see min, max, null count, and distinct count (sampled from up to 10,000 rows)
- File-level strip: row count, column count, file size, Parquet format version, row group count
- Geo metadata (for spatial files): geometry column, CRS, bounding box

### SQL panel (left panel)
- **SQL editor** — CodeMirror 6 with syntax highlighting, autocomplete seeded from column names, and `Ctrl/Cmd+Enter` to run
- **Visual query builder** — point-and-click interface for SELECT, WHERE, ORDER BY, LIMIT, and GROUP BY + aggregates; generated SQL is always visible and editable
- Default query auto-runs on file load (`SELECT * EXCLUDE (blob_cols) FROM data LIMIT 1000`)
- Inline error display with actionable messages (CORS, 403/404, ZSTD compression, invalid file)
- Query history: last 20 queries stored in `sessionStorage`, navigable with `Alt+↑/↓`
- Panel is resizable (drag the right edge) and collapsible

### Data table
- Virtualized rendering via `@tanstack/react-virtual` — handles large result sets without lag
- **Sortable columns** — click any column header to sort ascending, click again for descending, click a third time to clear
- Resizable columns (drag the right edge of any header)
- BLOB and GEOMETRY columns excluded from default queries and displayed as `[blob]` / `[geometry]`
- Row highlighting synced with map feature hover/selection

### Map view (spatial files)
- Appears automatically when a GeoParquet or spatial Parquet file is detected
- Fits to the bounding box from GeoParquet metadata immediately, before any query runs
- Points, lines, and polygons auto-styled by geometry type
- Click a map feature to open an attribute popup
- Bidirectional sync: hover/click a table row highlights the feature on the map, and vice versa
- CRS overlay shows the detected coordinate reference system; click to manually set an EPSG code if the file's CRS is missing or wrong
- Light and dark map styles follow the app theme

### Spatial detection (two tiers)
1. **GeoParquet spec** — reads the `geo` key from Parquet key-value metadata; extracts geometry column, encoding, CRS, and bounding box
2. **Column name heuristics** — falls back to scanning for columns named `geometry`, `geom`, `wkb_geometry`, `wkt`, `shape`

Supports WKB (BLOB), WKT (VARCHAR), and native DuckDB GEOMETRY types. The DuckDB spatial extension loads lazily — only when a spatial file is detected.

### Theme
Light, dark, and system default. Preference persists in `localStorage`.

---

## Known limitations

- **GeoArrow struct geometry** — files where geometry is stored as a GeoArrow struct type (e.g., `POINT_2D`, `POLYGON_2D`) are detected but features do not currently render on the map. WKB and WKT files are unaffected.
- **ZSTD compression** — not supported in the browser's WebAssembly engine. Re-compress with Snappy or Gzip:
  ```sql
  -- DuckDB CLI
  COPY (SELECT * FROM 'file.parquet') TO 'out.parquet' (FORMAT PARQUET, CODEC 'SNAPPY');
  ```
  ```python
  # Python / PyArrow
  import pyarrow.parquet as pq
  pq.write_table(pq.read_table('file.parquet'), 'out.parquet', compression='snappy')
  ```
- **Public files only** — no authentication. Private S3 buckets and files behind auth are not supported.
- **No pagination** — the `LIMIT` clause in your SQL controls how many rows are loaded. Default is 1,000.

---

## Tech stack

| Concern | Library |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS v3 |
| Query engine | `@duckdb/duckdb-wasm` |
| Maps | `maplibre-gl` |
| Map tiles | OpenFreeMap (`liberty` style) |
| Table virtualization | `@tanstack/react-virtual` |
| SQL editor | CodeMirror 6 + `@codemirror/lang-sql` |
| State management | Zustand |
| Routing | React Router (hash-based for GitHub Pages) |
| Deployment | GitHub Pages via GitHub Actions |

---

## Local development

```bash
git clone https://github.com/ar-puuk/parquet-viewer.git
cd parquet-viewer
npm install
npm run dev
```

The dev server runs at `http://localhost:5173/parquet-viewer/`.

> **Note:** The app requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers for DuckDB-WASM's `SharedArrayBuffer` support. The Vite dev server sets these automatically. If you serve the built output with a different tool, make sure those headers are present.

### Build

```bash
npm run build   # outputs to dist/
npm run preview # preview the production build locally
```

### Lint / format

```bash
npm run lint
npm run format
```

---

## Deployment

Pushes to `main` automatically build and deploy to GitHub Pages via the workflow in `.github/workflows/deploy.yml`. No manual steps required.

---

## Project structure

```
src/
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx        # Top nav, theme toggle
│   │   ├── SchemaSidebar.tsx   # Right panel: column list + stats
│   │   └── SplitLayout.tsx     # Resizable map/table split
│   ├── loader/
│   │   ├── DropZone.tsx        # Landing page: drag-and-drop + URL input
│   │   └── UrlInput.tsx        # HTTP/S3 URL input
│   ├── table/
│   │   ├── DataTable.tsx       # Virtualized, sortable results table
│   │   └── TableCell.tsx       # Type-aware cell renderer
│   ├── map/
│   │   └── MapView.tsx         # MapLibre GL wrapper
│   └── sql/
│       ├── SqlPanel.tsx        # Left panel: tabs, resize, collapse
│       ├── SqlEditor.tsx       # CodeMirror 6 editor
│       └── QueryBuilder.tsx    # Visual query builder
├── hooks/
│   ├── useDuckDB.ts            # Singleton DuckDB-WASM init
│   ├── useParquetFile.ts       # File registration, schema extraction, geo detection
│   ├── useSqlQuery.ts          # Query runner, injects __row_id
│   └── useGeoData.ts           # Geometry fetch, WKB/WKT decode, GeoJSON
├── store/
│   └── useAppStore.ts          # Zustand store
├── utils/
│   ├── s3url.ts                # S3 URL normalization
│   ├── geoDetect.ts            # Geo detection (GeoParquet spec + heuristics)
│   └── formatters.ts           # Cell value formatters
└── types/
    └── index.ts
```

---

## License

MIT
