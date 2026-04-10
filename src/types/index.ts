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
