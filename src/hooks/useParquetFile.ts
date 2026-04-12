import { useState } from 'react'
import * as duckdb from '@duckdb/duckdb-wasm'
import { queryDB, queryDBWithColumns, getDBInstance, getConnection } from './useDuckDB'
import { normalizeUrl } from '../utils/s3url'
import { useAppStore } from '../store/useAppStore'
import { detectGeo, ensureSpatialExtension, coordinatesLookGeographic } from '../utils/geoDetect'
import { classifyError } from '../utils/classifyError'
import type { ColumnInfo, FileStats } from '../types'

// Each file load gets a unique registration name so DuckDB's internal buffer-pool
// cache — keyed by (filename, page-offset) — never serves pages from a previous
// file.  Stale cache hits across same-named registrations were the root cause of
// spurious codec errors (e.g. ZSTD) when loading a second file in the same session.
let fileSeq = 0
let prevRegisteredName: string | null = null

function nextRegisteredName(): string {
  return `data_${++fileSeq}.parquet`
}

/**
 * After recreating the view with the spatial extension loaded, check the actual
 * DuckDB type for the geometry column. If DuckDB has resolved it to GEOMETRY,
 * switch to 'native' encoding so we use ST_AsGeoJSON("col") directly.
 */
async function resolveGeoEncoding(geoInfo: import('../types').GeoInfo): Promise<import('../types').GeoInfo> {
  try {
    const col = geoInfo.geometryColumn.replace(/'/g, "''")
    const rows = await queryDB(
      `SELECT column_type FROM (DESCRIBE data) WHERE column_name = '${col}' LIMIT 1`
    )
    const updatedType = String(rows[0]?.['column_type'] ?? '').split('(')[0].toUpperCase().trim()
    const GEOARROW_TYPES = new Set([
      'GEOMETRY',
      'POINT_2D', 'LINESTRING_2D', 'POLYGON_2D',
      'MULTIPOINT_2D', 'MULTILINESTRING_2D', 'MULTIPOLYGON_2D',
    ])
    if (GEOARROW_TYPES.has(updatedType)) {
      return { ...geoInfo, encoding: 'native' }
    }
  } catch {
    // If DESCRIBE fails for any reason, keep original encoding
  }
  return geoInfo
}

async function extractSchema(): Promise<ColumnInfo[]> {
  const descRows = await queryDB('SELECT column_name, column_type, "null" FROM (DESCRIBE data)')

  // DESCRIBE returns column names from the parquet file's own metadata, which can differ
  // from the names DuckDB actually uses when the view contains duplicate column names
  // (DuckDB appends _1, _2, etc. to deduplicate). Run SELECT * LIMIT 0 to get the
  // actual Arrow field names — these are the names that all subsequent queries must use.
  let actualNames: string[] | null = null
  try {
    const { columns } = await queryDBWithColumns('SELECT * FROM data LIMIT 0')
    if (columns.length === descRows.length) actualNames = columns
  } catch {
    // fall back to DESCRIBE names
  }

  return descRows.map((row, i) => ({
    name: actualNames?.[i] ?? String(row['column_name'] ?? ''),
    type: String(row['column_type'] ?? ''),
    nullable: String(row['null'] ?? 'YES').toUpperCase() === 'YES',
  }))
}

async function extractFileStats(fileSizeBytes: number | null, registeredName: string): Promise<FileStats> {
  // Row count via SELECT COUNT(*) — DuckDB reads only parquet footer for this
  const countRows = await queryDB('SELECT COUNT(*) AS cnt FROM data')
  const rowCount = Number(countRows[0]?.['cnt'] ?? 0)

  // Schema column count
  const schemaRows = await queryDB('SELECT COUNT(*) AS cnt FROM (DESCRIBE data)')
  const columnCount = Number(schemaRows[0]?.['cnt'] ?? 0)

  // Parquet file metadata
  let createdBy: string | null = null
  let rowGroupCount: number | null = null
  let formatVersion: number | null = null
  try {
    const metaRows = await queryDB(
      `SELECT created_by, num_row_groups, format_version FROM parquet_file_metadata('${registeredName}') LIMIT 1`
    )
    if (metaRows[0]) {
      createdBy = String(metaRows[0]['created_by'] ?? '').trim() || null
      rowGroupCount = Number(metaRows[0]['num_row_groups'] ?? null)
      formatVersion = Number(metaRows[0]['format_version'] ?? null)
    }
  } catch {
    // parquet_file_metadata may not be available for all files; silently skip
  }

  return { rowCount, columnCount, fileSizeBytes, createdBy, rowGroupCount, formatVersion }
}

/** Drop the previous file registration from DuckDB's VFS (best-effort). */
async function dropPrevFile(db: duckdb.AsyncDuckDB, conn: duckdb.AsyncDuckDBConnection) {
  await conn.query('DROP VIEW IF EXISTS data')
  if (prevRegisteredName) {
    try { await db.dropFile(prevRegisteredName) } catch { /* may not exist */ }
  }
}

export function useParquetFile() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { setActiveFile, setSchema, setFileStats, setGeoInfo } = useAppStore()

  async function loadFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      const db = getDBInstance()
      const conn = getConnection()
      if (!db || !conn) throw new Error('DuckDB is not ready yet')

      await dropPrevFile(db, conn)
      const registeredName = nextRegisteredName()
      prevRegisteredName = registeredName

      const buffer = await file.arrayBuffer()
      await db.registerFileBuffer(registeredName, new Uint8Array(buffer))
      await conn.query(`CREATE OR REPLACE VIEW data AS SELECT * FROM read_parquet('${registeredName}')`)

      const [schema, stats] = await Promise.all([
        extractSchema(),
        extractFileStats(file.size, registeredName),
      ])

      let geoInfo = await detectGeo(schema, registeredName)
      let finalSchema = schema
      if (geoInfo) {
        await ensureSpatialExtension()
        // Recreate the view with the spatial extension active so DuckDB resolves
        // GeoArrow struct columns and WKB blobs to its native GEOMETRY type.
        await conn.query(`CREATE OR REPLACE VIEW data AS SELECT * FROM read_parquet('${registeredName}')`)
        geoInfo = await resolveGeoEncoding(geoInfo)
        // Re-extract schema: the spatial extension may change column types (e.g. BLOB → GEOMETRY).
        finalSchema = await extractSchema()
        // If no CRS metadata was found (Tier 2 detection assumed WGS84), sample a few
        // coordinate values to check whether they actually look geographic. Projected
        // coordinates (e.g. UTM in metres) far exceed the WGS84 degree range.
        if (geoInfo.isWGS84) {
          const looksGeo = await coordinatesLookGeographic(geoInfo)
          if (!looksGeo) geoInfo = { ...geoInfo, isWGS84: false }
        }
      }

      setSchema(finalSchema)
      setFileStats(stats)
      setGeoInfo(geoInfo)
      setActiveFile({ name: file.name, type: 'local', registeredAs: registeredName, fileSizeBytes: file.size })
    } catch (e) {
      setError(classifyError(e))
    } finally {
      setLoading(false)
    }
  }

  async function loadUrl(rawUrl: string) {
    setLoading(true)
    setError(null)
    try {
      const db = getDBInstance()
      const conn = getConnection()
      if (!db || !conn) throw new Error('DuckDB is not ready yet')

      await dropPrevFile(db, conn)
      const registeredName = nextRegisteredName()
      prevRegisteredName = registeredName

      const url = normalizeUrl(rawUrl)
      await db.registerFileURL(
        registeredName,
        url,
        duckdb.DuckDBDataProtocol.HTTP,
        false
      )
      await conn.query(`CREATE OR REPLACE VIEW data AS SELECT * FROM read_parquet('${registeredName}')`)

      const fileName = url.split('/').pop() ?? url

      const [schema, stats] = await Promise.all([
        extractSchema(),
        extractFileStats(null, registeredName),
      ])

      let geoInfo = await detectGeo(schema, registeredName)
      let finalSchema = schema
      if (geoInfo) {
        await ensureSpatialExtension()
        await conn.query(`CREATE OR REPLACE VIEW data AS SELECT * FROM read_parquet('${registeredName}')`)
        geoInfo = await resolveGeoEncoding(geoInfo)
        finalSchema = await extractSchema()
        if (geoInfo.isWGS84) {
          const looksGeo = await coordinatesLookGeographic(geoInfo)
          if (!looksGeo) geoInfo = { ...geoInfo, isWGS84: false }
        }
      }

      setSchema(finalSchema)
      setFileStats(stats)
      setGeoInfo(geoInfo)
      setActiveFile({ name: fileName, type: 'url', registeredAs: registeredName, fileSizeBytes: null })
    } catch (e) {
      setError(classifyError(e))
    } finally {
      setLoading(false)
    }
  }

  return { loadFile, loadUrl, loading, error, clearError: () => setError(null) }
}
