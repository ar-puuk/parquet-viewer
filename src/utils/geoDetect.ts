import { queryDB } from '../hooks/useDuckDB'
import type { ColumnInfo } from '../types'

const REGISTERED_NAME = 'data.parquet'

// Known geometry column names for Tier 2 heuristic detection
const GEO_COLUMN_NAMES = new Set(['geometry', 'geom', 'wkb_geometry', 'shape'])
const WKT_COLUMN_NAMES = new Set(['wkt'])

let spatialLoaded = false

/** Load the DuckDB spatial extension exactly once per session. */
export async function ensureSpatialExtension(): Promise<void> {
  if (spatialLoaded) return
  try {
    await queryDB('LOAD spatial')
    spatialLoaded = true
  } catch {
    // Extension not installed yet — try installing first
    await queryDB('INSTALL spatial')
    await queryDB('LOAD spatial')
    spatialLoaded = true
  }
}

export interface GeoInfo {
  geometryColumn: string
  encoding: 'wkb' | 'wkt'
  /** Raw CRS string from metadata (null = WGS84 assumed) */
  crsString: string | null
  isWGS84: boolean
}

/**
 * Detect whether the loaded parquet file contains geometry.
 * Tier 1: parquet key-value metadata `geo` key (GeoParquet spec).
 * Tier 2: column name / type heuristics.
 */
export async function detectGeo(schema: ColumnInfo[]): Promise<GeoInfo | null> {
  // ── Tier 1: GeoParquet spec metadata ──────────────────────────────────────
  try {
    const rows = await queryDB(
      `SELECT decode(value) AS geo_meta
       FROM parquet_kv_metadata('${REGISTERED_NAME}')
       WHERE decode(key) = 'geo'
       LIMIT 1`
    )
    const raw = rows[0]?.['geo_meta']
    if (raw) {
      const meta = JSON.parse(String(raw)) as {
        primary_column?: string
        columns?: Record<string, { encoding?: string; crs?: unknown }>
      }
      const primaryCol =
        meta.primary_column ?? Object.keys(meta.columns ?? {})[0] ?? null
      if (primaryCol) {
        const colMeta = meta.columns?.[primaryCol]
        const encoding =
          (colMeta?.encoding ?? 'WKB').toUpperCase() === 'WKT' ? 'wkt' : 'wkb'

        let isWGS84 = true
        let crsString: string | null = null
        if (colMeta?.crs) {
          crsString = JSON.stringify(colMeta.crs)
          // PROJJSON: check id.code === 4326 (WGS 84)
          const crsObj = colMeta.crs as Record<string, unknown>
          const code =
            (crsObj?.id as Record<string, unknown>)?.code ??
            ((crsObj?.components as Array<Record<string, unknown>>)?.[0]?.id as Record<string, unknown>)?.code
          isWGS84 = code == null || code === 4326 || code === '4326'
        }
        return { geometryColumn: primaryCol, encoding, crsString, isWGS84 }
      }
    }
  } catch {
    // No geo metadata or metadata parse error — fall through to Tier 2
  }

  // ── Tier 2: column name + type heuristics ─────────────────────────────────
  for (const col of schema) {
    const lower = col.name.toLowerCase()
    const upperType = col.type.split('(')[0].toUpperCase().trim()

    if (WKT_COLUMN_NAMES.has(lower) && upperType === 'VARCHAR') {
      return { geometryColumn: col.name, encoding: 'wkt', crsString: null, isWGS84: true }
    }
    if (GEO_COLUMN_NAMES.has(lower) && upperType === 'BLOB') {
      return { geometryColumn: col.name, encoding: 'wkb', crsString: null, isWGS84: true }
    }
  }

  // Looser pass: any BLOB whose name contains geo/geom/wkb
  for (const col of schema) {
    const lower = col.name.toLowerCase()
    const upperType = col.type.split('(')[0].toUpperCase().trim()
    if (upperType === 'BLOB' && (lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))) {
      return { geometryColumn: col.name, encoding: 'wkb', crsString: null, isWGS84: true }
    }
  }

  return null
}
