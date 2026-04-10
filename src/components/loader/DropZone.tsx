export function DropZone() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        {/* Drop zone */}
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-12 text-center hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors cursor-pointer group">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900 transition-colors">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-8 h-8 text-indigo-500"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>
            <div>
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                Drop a Parquet file here
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                or click to browse — supports <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">.parquet</code> and GeoParquet files
              </p>
            </div>
            <button
              type="button"
              className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Choose file
            </button>
          </div>
        </div>

        {/* URL input */}
        <div className="mt-6">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            Or load from URL
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="https://example.com/data.parquet  or  s3://bucket/key.parquet"
              className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              readOnly
            />
            <button
              type="button"
              className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors"
            >
              Load
            </button>
          </div>
        </div>

        {/* Example files note */}
        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-600">
          Public S3 buckets and HTTP URLs supported · No data leaves your browser
        </p>
      </div>
    </div>
  )
}
