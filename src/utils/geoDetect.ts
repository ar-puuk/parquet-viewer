import { queryDB } from '../hooks/useDuckDB'
import type { ColumnInfo, GeoInfo } from '../types'

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

        return { geometryColumn: primaryCol, encoding, crsString, isWGS84, bbox, epsg }
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
      return { geometryColumn: col.name, encoding: 'native', crsString: null, isWGS84: true, bbox: null, epsg: null }
    }

    // GeoArrow struct aliases (POINT_2D = STRUCT(x,y), POLYGON_2D = STRUCT(x,y)[][], etc.)
    if (
      upperType === 'STRUCT' &&
      (GEO_COLUMN_NAMES.has(lower) || lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))
    ) {
      return { geometryColumn: col.name, encoding: 'struct', structType: col.type, crsString: null, isWGS84: true, bbox: null, epsg: null }
    }

    // WKT: VARCHAR columns with known WKT names, or geo-named VARCHAR columns
    if ((WKT_COLUMN_NAMES.has(lower) || GEO_COLUMN_NAMES.has(lower)) && upperType === 'VARCHAR') {
      return { geometryColumn: col.name, encoding: 'wkt', crsString: null, isWGS84: true, bbox: null, epsg: null }
    }

    // WKB: BLOB columns with known geo names
    if (GEO_COLUMN_NAMES.has(lower) && upperType === 'BLOB') {
      return { geometryColumn: col.name, encoding: 'wkb', crsString: null, isWGS84: true, bbox: null, epsg: null }
    }
  }

  // Looser pass: any BLOB, GEOMETRY, or STRUCT column whose name contains geo/geom/wkb
  for (const col of schema) {
    const lower = col.name.toLowerCase()
    const upperType = col.type.split('(')[0].toUpperCase().trim()
    if (upperType === 'GEOMETRY' && (lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))) {
      return { geometryColumn: col.name, encoding: 'native', crsString: null, isWGS84: true, bbox: null, epsg: null }
    }
    if (upperType === 'STRUCT' && (lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))) {
      return { geometryColumn: col.name, encoding: 'struct', structType: col.type, crsString: null, isWGS84: true, bbox: null, epsg: null }
    }
    if (upperType === 'BLOB' && (lower.includes('geo') || lower.includes('geom') || lower.includes('wkb'))) {
      return { geometryColumn: col.name, encoding: 'wkb', crsString: null, isWGS84: true, bbox: null, epsg: null }
    }
  }

  // Final fallback: exact name match regardless of type (covers unusual DuckDB type names)
  for (const col of schema) {
    const lower = col.name.toLowerCase()
    const upperType = col.type.split('(')[0].toUpperCase().trim()
    if (GEO_COLUMN_NAMES.has(lower)) {
      const encoding =
        upperType === 'VARCHAR' ? 'wkt' :
        upperType === 'GEOMETRY' ? 'native' :
        upperType === 'STRUCT' ? 'struct' : 'wkb'
      const structType = encoding === 'struct' ? col.type : undefined
      return { geometryColumn: col.name, encoding, structType, crsString: null, isWGS84: true, bbox: null, epsg: null }
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
        // native GEOMETRY
        geomExpr = col
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
