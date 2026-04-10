import { isGeometryColumn, isNumericType, formatCellDisplay } from '../../utils/formatters'

interface Props {
  value: unknown
  colName: string
  colType: string
}

export function TableCell({ value, colName, colType }: Props) {
  const baseType = colType.split('(')[0].toUpperCase().trim()

  // BLOB columns are excluded from table queries to avoid massive payloads.
  // Show a static placeholder — value will always be undefined for these.
  if (baseType === 'BLOB') {
    const label = isGeometryColumn(colName, colType) ? '[geometry]' : '[blob]'
    return (
      <div className="px-2 h-full flex items-center">
        <span className="text-xs text-gray-400 dark:text-gray-600 font-mono">{label}</span>
      </div>
    )
  }

  // Null / undefined
  if (value === null || value === undefined) {
    return (
      <div className="px-2 h-full flex items-center">
        <span className="text-gray-300 dark:text-gray-700 text-xs select-none">—</span>
      </div>
    )
  }

  // Boolean badges
  if (typeof value === 'boolean') {
    return (
      <div className="px-2 h-full flex items-center">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            value
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
          }`}
        >
          {String(value)}
        </span>
      </div>
    )
  }

  const isNum = isNumericType(colType) || typeof value === 'number'
  const display = formatCellDisplay(value)

  return (
    <div className={`px-2 h-full flex items-center overflow-hidden ${isNum ? 'justify-end' : ''}`}>
      <span
        className={`text-xs truncate ${
          isNum
            ? 'font-mono text-gray-700 dark:text-gray-300'
            : 'text-gray-800 dark:text-gray-200'
        }`}
      >
        {display}
      </span>
    </div>
  )
}
