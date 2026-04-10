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
  /** wkb = BLOB binary, wkt = VARCHAR text, native = DuckDB GEOMETRY type */
  encoding: 'wkb' | 'wkt' | 'native'
  /** Raw CRS string from metadata (null = WGS84 assumed) */
  crsString: string | null
  isWGS84: boolean
  /** Bounding box from GeoParquet metadata [minx, miny, maxx, maxy], if present */
  bbox: [number, number, number, number] | null
  /** Source EPSG code. null = unknown (assumed 4326). Used for ST_Transform. */
  epsg: number | null
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  /** Column names in result order */
  columns: string[]
  sql: string
  executionMs: number
}
