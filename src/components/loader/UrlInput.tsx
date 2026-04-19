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
      <p className="text-[11px] font-semibold text-[#a8977a] dark:text-[#485868] uppercase tracking-widest mb-2">
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
          className="flex-1 px-3 py-2 text-sm bg-white dark:bg-[#192430] border border-[#d4c5a9] dark:border-[#253545] rounded-lg text-[#1c1208] dark:text-[#f0ebe0] placeholder:text-[#a8977a] dark:placeholder:text-[#485868] focus:outline-none focus:ring-2 focus:ring-[#b45309]/25 dark:focus:ring-[#fbbf24]/25 focus:border-[#b45309] dark:focus:border-[#fbbf24] disabled:opacity-50 disabled:cursor-not-allowed transition-shadow duration-150"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className="px-4 py-2 bg-[#1c1208] dark:bg-[#f0ebe0] text-white dark:text-[#1c1208] text-sm font-medium rounded-lg hover:bg-[#2e1c08] dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
        >
          Load
        </button>
      </div>
      {validationError && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{validationError}</p>
      )}
    </div>
  )
}
