import { useState, type KeyboardEvent } from 'react'
import { isValidUrl } from '../../utils/s3url'

interface Props {
  onSubmit: (url: string) => void
  disabled?: boolean
}

export function UrlInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed) return
    if (!isValidUrl(trimmed)) {
      setValidationError('Enter a valid HTTP/HTTPS URL or s3://bucket/key path')
      return
    }
    setValidationError(null)
    onSubmit(trimmed)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSubmit()
  }

  return (
    <div className="mt-6">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
        Or load from URL
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setValidationError(null) }}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com/data.parquet  or  s3://bucket/key.parquet"
          disabled={disabled}
          className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Load
        </button>
      </div>
      {validationError && (
        <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">{validationError}</p>
      )}
    </div>
  )
}
