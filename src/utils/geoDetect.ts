import { queryDB } from '../hooks/useDuckDB'
import type { ColumnInfo, GeoInfo } from '../types'

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

// ── Esri JSON helpers ─────────────────────────────────────────────────────────

/**
 * Return true if the STRUCT type string looks like an Esri JSON geometry
 * (has a 'rings', 'paths', or 'points' field rather than GeoArrow x/y fields).
 */
function isEsriJsonStructType(structType: string): boolean {
  const lower = structType.toLowerCase()
  return lower.startsWith('struct(') && (
    lower.includes('rings') || lower.includes('paths') || lower.includes('points')
  )
}

/**
 * Sample one row of a VARCHAR column and check whether it looks like an Esri
 * JSON geometry object (starts with '{' and has rings/paths/points/x+y keys).
 * Returns false on any error so we fall back to treating it as WKT.
 */
async function looksLikeEsriJson(colName: string): Promise<boolean> {
  try {
    const col = `"${colName.replace(/"/g, '""')}"`
    const rows = await queryDB(`SELECT ${col} AS v FROM data WHERE ${col} IS NOT NULL LIMIT 1`)
    const raw = rows[0]?.['v']
    if (raw == null) return false
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const trimmed = str.trim()
    if (!trimmed.startsWith('{')) return false
    // Use string-based detection to handle both valid JSON and Python-dict-format
    // strings (single-quoted keys) produced by Esri tools.
    return trimmed.includes("'rings'") || trimmed.includes('"rings"') ||
           trimmed.includes("'paths'") || trimmed.includes('"paths"') ||
           trimmed.includes("'points'") || trimmed.includes('"points"') ||
           ((trimmed.includes("'x'") || trimmed.includes('"x"')) &&
            (trimmed.includes("'spatialReference'") || trimmed.includes('"spatialReference"')))
  } catch {
    return false
  }
}

/**
 * Try to read the EPSG code from a sampled Esri JSON geometry's
 * spatialReference.wkid field. Works for both VARCHAR and STRUCT columns.
 */
async function extractEsriEpsg(colName: string): Promise<number | null> {
  try {
    const col = `"${colName.replace(/"/g, '""')}"`
    const rows = await queryDB(`SELECT ${col} AS v FROM data WHERE ${col} IS NOT NULL LIMIT 1`)
    const raw = rows[0]?.['v']
    if (raw == null) return null
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    // Normalise Python-dict single-quoted keys to double quotes before parsing.
    // Safe because Esri geometry JSON values are all numbers — no string values
    // that could contain apostrophes.
    const jsonStr = str.replace(/'/g, '"')
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>
    const sr = parsed['spatialReference'] as Record<string, unknown> | undefined
    const wkid = sr?.['wkid'] ?? sr?.['latestWkid']
    return wkid != null ? Number(wkid) : null
  } catch {
    return null
  }
}

/**
 * Detect whether the loaded parquet file contains geometry.
 * Tier 1: parquet key-value metadata `geo` key (GeoParquet spec).
 * Tier 2: column name / type heuristics (including Esri JSON detection).
 */
export async function detectGeo(schema: ColumnInfo[], registeredName: string): Promise<GeoInfo | null> {
  // ── Tier 1: GeoParquet spec metadata ──────────────────────────────────────
  try {
    const rows = await queryDB(
      `SELECT decode(value) AS geo_meta
       FROM parquet_kv_metadata('${registeredName}')
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
        let epsg: number | null = null
        if (colMeta?.crs) {
          crsString = JSON.stringify(colMeta.crs)
          // PROJJSON: check id.code === 4326 (WGS 84)
          const crsObj = colMeta.crs as Record<string, unknown>
          const rawCode =
            (crsObj?.id as Record<string, unknown>)?.code ??
            ((crsObj?.components as Array<Record<string, unknown>>)?.[0]?.id as Record<string, unknown>)?.code
          epsg = rawCode != null ? Number(rawCode) : null
          isWGS84 = epsg == null || epsg === 4326
        }

        // Extract bounding box [minx, miny, maxx, maxy] from metadata if present
        let bbox: [number, number, number, number] | null = null
        const rawBbox = (colMeta as Record<string, unknown> | undefined)?.['bbox']
        if (Array.isArray(rawBbox) && rawBbox.length === 4) {
          const b = rawBbox.map(Number)
          if (b.every(isFinite)) bbox = b as [number, number, number, number]
        }

        return { geometryColumn: primaryCol, encoding, crsString, isWGS84, bbox, epsg, proj4String: null }
      }
    }
  } catch {
    // No geo metadata or metadata parse error — fall through to Tier 2
  }

  // ── Tier 2: column name + type heuristics ─────────────────────────────────
  for (const col of schema) {
    const lower = col.name.toLowerCase()
    const upperType = col.type.split('(')[0].toUpperCase().trim()

    // DuckDB native GEOMETRY type
    if (
      upperType === 'GEOMETRY' &&
      (GEO_COLUMN_NAMES.has(lower) || lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))
    ) {
      return { geometryColumn: col.name, encoding: 'native', crsString: null, isWGS84: true, bbox: null, epsg: null, proj4String: null }
    }

    // STRUCT columns — distinguish GeoArrow (x/y fields) from Esri JSON (rings/paths)
    if (
      upperType === 'STRUCT' &&
      (GEO_COLUMN_NAMES.has(lower) || lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))
    ) {
      if (isEsriJsonStructType(col.type)) {
        const epsg = await extractEsriEpsg(col.name)
        const isWGS84 = epsg == null || epsg === 4326
        return { geometryColumn: col.name, encoding: 'esri', crsString: null, isWGS84, bbox: null, epsg, proj4String: null }
      }
      return { geometryColumn: col.name, encoding: 'struct', structType: col.type, crsString: null, isWGS84: true, bbox: null, epsg: null, proj4String: null }
    }

    // VARCHAR — could be WKT or Esri JSON; sample a row to tell them apart
    if ((WKT_COLUMN_NAMES.has(lower) || GEO_COLUMN_NAMES.has(lower)) && upperType === 'VARCHAR') {
      if (await looksLikeEsriJson(col.name)) {
        const epsg = await extractEsriEpsg(col.name)
        const isWGS84 = epsg == null || epsg === 4326
        return { geometryColumn: col.name, encoding: 'esri', crsString: null, isWGS84, bbox: null, epsg, proj4String: null }
      }
      return { geometryColumn: col.name, encoding: 'wkt', crsString: null, isWGS84: true, bbox: null, epsg: null, proj4String: null }
    }

    // WKB: BLOB columns with known geo names
    if (GEO_COLUMN_NAMES.has(lower) && upperType === 'BLOB') {
      return { geometryColumn: col.name, encoding: 'wkb', crsString: null, isWGS84: true, bbox: null, epsg: null, proj4String: null }
    }
  }

  // Looser pass: any BLOB, GEOMETRY, or STRUCT column whose name contains geo/geom/wkb
  for (const col of schema) {
    const lower = col.name.toLowerCase()
    const upperType = col.type.split('(')[0].toUpperCase().trim()
    if (upperType === 'GEOMETRY' && (lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))) {
      return { geometryColumn: col.name, encoding: 'native', crsString: null, isWGS84: true, bbox: null, epsg: null, proj4String: null }
    }
    if (upperType === 'STRUCT' && (lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))) {
      if (isEsriJsonStructType(col.type)) {
        const epsg = await extractEsriEpsg(col.name)
        const isWGS84 = epsg == null || epsg === 4326
        return { geometryColumn: col.name, encoding: 'esri', crsString: null, isWGS84, bbox: null, epsg, proj4String: null }
      }
      return { geometryColumn: col.name, encoding: 'struct', structType: col.type, crsString: null, isWGS84: true, bbox: null, epsg: null, proj4String: null }
    }
    if (upperType === 'BLOB' && (lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))) {
      return { geometryColumn: col.name, encoding: 'wkb', crsString: null, isWGS84: true, bbox: null, epsg: null, proj4String: null }
    }
  }

  // Final fallback: exact name match regardless of type
  for (const col of schema) {
    const lower = col.name.toLowerCase()
    const upperType = col.type.split('(')[0].toUpperCase().trim()
    if (GEO_COLUMN_NAMES.has(lower)) {
      if (upperType === 'VARCHAR' && await looksLikeEsriJson(col.name)) {
        const epsg = await extractEsriEpsg(col.name)
        const isWGS84 = epsg == null || epsg === 4326
        return { geometryColumn: col.name, encoding: 'esri', crsString: null, isWGS84, bbox: null, epsg, proj4String: null }
      }
      if (upperType === 'STRUCT' && isEsriJsonStructType(col.type)) {
        const epsg = await extractEsriEpsg(col.name)
        const isWGS84 = epsg == null || epsg === 4326
        return { geometryColumn: col.name, encoding: 'esri', crsString: null, isWGS84, bbox: null, epsg, proj4String: null }
      }
      const encoding =
        upperType === 'VARCHAR' ? 'wkt' :
        upperType === 'GEOMETRY' ? 'native' :
        upperType === 'STRUCT' ? 'struct' : 'wkb'
      const structType = encoding === 'struct' ? col.type : undefined
      return { geometryColumn: col.name, encoding, structType, crsString: null, isWGS84: true, bbox: null, epsg: null, proj4String: null }
    }
  }

  return null
}

// ── Coordinate range check ─────────────────────────────────────────────────────

/**
 * Sample up to 5 non-null rows and inspect the first coordinate pair.
 * Returns false when any coordinate is clearly outside the WGS84 range
 * (|x| > 180 or |y| > 90 by a wide margin), indicating a projected CRS.
 *
 * Returns true (geographic) on any error so we never emit false-positive
 * warnings. Must be called after ensureSpatialExtension() has loaded.
 */
export async function coordinatesLookGeographic(geoInfo: GeoInfo): Promise<boolean> {
  const col = `"${geoInfo.geometryColumn}"`

  try {
    if (geoInfo.encoding === 'esri') {
      // EPSG was already extracted from spatialReference.wkid during detection;
      // no need to sample coordinates — isWGS84 is already set correctly.
      return geoInfo.isWGS84
    }

    if (geoInfo.encoding === 'struct') {
      // GeoArrow struct — access x/y fields directly without ST_* functions
      const depth = (geoInfo.structType ?? '').match(/\[\]/g)?.length ?? 0
      let xExpr: string
      let yExpr: string
      let whereExtra = ''

      if (depth === 0) {
        xExpr = `${col}.x`
        yExpr = `${col}.y`
      } else if (depth === 1) {
        xExpr = `${col}[1].x`
        yExpr = `${col}[1].y`
        whereExtra = ` AND len(${col}) > 0`
      } else {
        xExpr = `${col}[1][1].x`
        yExpr = `${col}[1][1].y`
        whereExtra = ` AND len(${col}) > 0 AND len(${col}[1]) > 0`
      }

      const rows = await queryDB(
        `SELECT ${xExpr} AS x, ${yExpr} AS y
         FROM data
         WHERE ${col} IS NOT NULL${whereExtra}
         LIMIT 5`
      )
      for (const row of rows) {
        const x = Number(row['x'])
        const y = Number(row['y'])
        if (isFinite(x) && isFinite(y) && (Math.abs(x) > 180 || Math.abs(y) > 90)) return false
      }
      return true
    } else {
      // wkb / wkt / native — convert to GeoJSON and parse first coordinate
      let geomExpr: string
      if (geoInfo.encoding === 'wkb') {
        geomExpr = `ST_GeomFromWKB(${col})`
      } else if (geoInfo.encoding === 'wkt') {
        geomExpr = `ST_GeomFromText(${col})`
      } else {
        // native GEOMETRY or GeoArrow alias (POLYGON_2D etc.) — ::GEOMETRY cast
        // ensures the spatial extension can convert either to GeoJSON.
        geomExpr = `${col}::GEOMETRY`
      }

      const rows = await queryDB(
        `SELECT ST_AsGeoJSON(${geomExpr}) AS g
         FROM data
         WHERE ${col} IS NOT NULL
         LIMIT 5`
      )
      for (const row of rows) {
        const raw = row['g']
        if (!raw) continue
        const geom = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) as Record<string, unknown>
        const coord = firstCoordFromGeojson(geom)
        if (!coord) continue
        const [x, y] = coord
        if (isFinite(x) && isFinite(y) && (Math.abs(x) > 180 || Math.abs(y) > 90)) return false
      }
      return true
    }
  } catch {
    // Fail-safe: on any error assume geographic so we don't warn unnecessarily
    return true
  }
}

function firstCoordFromGeojson(geom: Record<string, unknown>): [number, number] | null {
  if (!geom || !geom.type) return null
  switch (geom.type as string) {
    case 'Point':
      return geom.coordinates as [number, number]
    case 'MultiPoint':
    case 'LineString':
      return ((geom.coordinates as [number, number][])[0]) ?? null
    case 'MultiLineString':
    case 'Polygon':
      return ((geom.coordinates as [number, number][][])[0])?.[0] ?? null
    case 'MultiPolygon':
      return (((geom.coordinates as [number, number][][][])[0])?.[0])?.[0] ?? null
    case 'GeometryCollection': {
      const geoms = geom.geometries as Array<Record<string, unknown>>
      return geoms.length > 0 ? firstCoordFromGeojson(geoms[0]) : null
    }
    default:
      return null
  }
}
