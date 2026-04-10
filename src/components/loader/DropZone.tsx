import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { useDuckDB } from '../../hooks/useDuckDB'
import { useParquetFile } from '../../hooks/useParquetFile'
import { UrlInput } from './UrlInput'

export function DropZone() {
  const { status: dbStatus, error: dbError } = useDuckDB()
  const { loadFile, loadUrl, loading, error, clearError } = useParquetFile()
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isReady = dbStatus === 'ready'

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave() {
    setDragging(false)
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) await loadFile(file)
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await loadFile(file)
  }

  const fileError = error ?? (dbStatus === 'error' ? `DuckDB failed to initialize: ${dbError}` : null)

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">

        {/* DuckDB init progress */}
        {dbStatus === 'initializing' && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 justify-center">
            <svg className="animate-spin w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Initializing query engine…
          </div>
        )}

        {/* Error banner */}
        {fileError && (
          <div className="mb-4 flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0 mt-0.5">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span className="flex-1">{fileError}</span>
            <button onClick={clearError} className="text-red-500 hover:text-red-700 dark:hover:text-red-200">✕</button>
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => isReady && !loading && fileInputRef.current?.click()}
          className={[
            'border-2 border-dashed rounded-2xl p-12 text-center transition-colors',
            isReady && !loading ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            dragging
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
              : 'border-gray-300 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500',
          ].join(' ')}
        >
          <div className="flex flex-col items-center gap-4">
            <div className={[
              'w-16 h-16 rounded-2xl flex items-center justify-center transition-colors',
              dragging
                ? 'bg-indigo-100 dark:bg-indigo-900'
                : 'bg-indigo-50 dark:bg-indigo-950',
            ].join(' ')}>
              {loading ? (
                <svg className="animate-spin w-8 h-8 text-indigo-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-indigo-500">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              )}
            </div>
            <div>
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {loading ? 'Loading file…' : 'Drop a Parquet file here'}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {loading
                  ? 'Reading schema and metadata'
                  : <>or click to browse — supports <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">.parquet</code> and GeoParquet</>
                }
              </p>
            </div>
            {!loading && (
              <button
                type="button"
                disabled={!isReady}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                Choose file
              </button>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".parquet"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* URL input */}
        <UrlInput onSubmit={loadUrl} disabled={!isReady || loading} />

        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-600">
          Public S3 buckets and HTTP URLs supported · No data leaves your browser
        </p>
      </div>
    </div>
  )
}
