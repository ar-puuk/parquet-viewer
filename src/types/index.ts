export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
}

export interface FileStats {
  rowCount: number
  columnCount: number
  fileSizeBytes: number | null
  createdBy: string | null
  rowGroupCount: number | null
  formatVersion: number | null
}

export interface ActiveFile {
  name: string
  type: 'local' | 'url'
  /** The path/name registered with DuckDB (always 'data.parquet' in current impl) */
  registeredAs: string
  fileSizeBytes: number | null
}

export interface GeoInfo {
  geometryColumn: string
  /**
   * wkb    = BLOB binary (ST_GeomFromWKB)
   * wkt    = VARCHAR text (ST_GeomFromText)
   * native = DuckDB GEOMETRY type (ST_AsGeoJSON / ST_Transform directly)
   * struct = GeoArrow struct alias (POINT_2D / POLYGON_2D / etc.) —
   *          DuckDB has no cast to GEOMETRY for these; WKT is built via
   *          list_transform + list_aggregate, then ST_GeomFromText is used
   */
  encoding: 'wkb' | 'wkt' | 'native' | 'struct'
  /**
   * Raw DuckDB column type for 'struct' encoding (e.g. STRUCT(x DOUBLE, y DOUBLE)[][]).
   * Used to derive nesting depth → geometry type for WKT construction.
   */
  structType?: string
  /** Raw CRS string from metadata (null = WGS84 assumed) */
  crsString: string | null
  isWGS84: boolean
  /** Bounding box from GeoParquet metadata [minx, miny, maxx, maxy], if present */
  bbox: [number, number, number, number] | null
  /** Source EPSG code. null = unknown (assumed 4326). */
  epsg: number | null
  /**
   * proj4 definition string fetched from epsg.io for the source CRS.
   * Populated when the user applies a CRS override. Used for client-side
   * coordinate reprojection (proj4js) instead of DuckDB ST_Transform, which
   * is unreliable in the WASM build due to a stripped PROJ database.
   */
  proj4String: string | null
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  /** Column names in result order */
  columns: string[]
  sql: string
  executionMs: number
}
