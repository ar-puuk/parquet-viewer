import { isGeometryColumn, isNumericType, formatCellDisplay } from '../../utils/formatters'

interface Props {
  value: unknown
  colName: string
  colType: string
}

export function TableCell({ value, colName, colType }: Props) {
  const baseType = colType.split('(')[0].toUpperCase().trim()

  if (baseType === 'BLOB') {
    const label = isGeometryColumn(colName, colType) ? '[geometry]' : '[blob]'
    return (
      <div className="px-2 h-full flex items-center">
        <span className="text-xs text-[#a8977a] dark:text-[#485868] font-mono italic">{label}</span>
      </div>
    )
  }

  if (value === null || value === undefined) {
    return (
      <div className="px-2 h-full flex items-center">
        <span className="text-[#d4c5a9] dark:text-[#2f4258] text-xs select-none font-mono">—</span>
      </div>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <div className="px-2 h-full flex items-center">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            value
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-[#f2ece0] text-[#a8977a] dark:bg-[#253545] dark:text-[#485868]'
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
            ? 'font-mono tabular-nums text-[#1c1208] dark:text-[#e8c87a]'
            : 'text-[#1c1208] dark:text-[#f0ebe0]'
        }`}
      >
        {display}
      </span>
    </div>
  )
}
