const GEOMETRY_TYPES = new Set(['GEOMETRY', 'WKB_BLOB'])
const GEOMETRY_COL_NAMES = new Set(['geometry', 'geom', 'wkb_geometry', 'wkt', 'shape'])

export function isGeometryColumn(colName: string, colType: string): boolean {
  const upperType = colType.split('(')[0].toUpperCase().trim()
  if (upperType === 'BLOB' || GEOMETRY_TYPES.has(upperType)) return true
  return GEOMETRY_COL_NAMES.has(colName.toLowerCase())
}

const NUMERIC_TYPES = new Set([
  'INTEGER', 'BIGINT', 'HUGEINT', 'SMALLINT', 'TINYINT',
  'UBIGINT', 'UINTEGER', 'USMALLINT', 'UTINYINT',
  'DOUBLE', 'FLOAT', 'REAL', 'DECIMAL', 'NUMERIC',
])

export function isNumericType(colType: string): boolean {
  const base = colType.split('(')[0].toUpperCase().trim()
  return NUMERIC_TYPES.has(base)
}

export function getDefaultColWidth(colType: string, colName: string): number {
  if (isGeometryColumn(colName, colType)) return 100
  const base = colType.split('(')[0].toUpperCase().trim()
  if (base === 'BOOLEAN') return 90
  if (NUMERIC_TYPES.has(base)) return 120
  if (base === 'DATE') return 120
  if (base.startsWith('TIMESTAMP')) return 190
  if (base === 'VARCHAR') return 200
  return 150
}

export function formatCellDisplay(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
