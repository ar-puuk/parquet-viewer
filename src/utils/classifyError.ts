/**
 * Convert a raw caught error into a human-readable message.
 * Used by both the file-loading hooks and the SQL query hook so that
 * DuckDB errors (e.g. ZSTD decompression) are explained consistently
 * regardless of where they surface.
 */
export function classifyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (
    lower.includes('cors') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('cross-origin')
  ) {
    return (
      'CORS error: the server does not allow cross-origin requests. ' +
      'Try downloading the file and loading it locally instead.'
    )
  }
  if (lower.includes('http') && (lower.includes('403') || lower.includes('forbidden'))) {
    return 'Access denied (403): this file is not publicly accessible.'
  }
  if (lower.includes('http') && (lower.includes('404') || lower.includes('not found'))) {
    return 'File not found (404): check that the URL is correct.'
  }
  if (lower.includes('not a parquet file') || lower.includes('invalid parquet')) {
    return 'Invalid file: this does not appear to be a valid Parquet file.'
  }
  if (lower.includes('zstd') || lower.includes('zstandard')) {
    return (
      'ZSTD compression is not supported in this browser\'s WebAssembly engine.\n\n' +
      'Re-compress the file using Snappy or Gzip, then reload:\n\n' +
      '  # DuckDB CLI\n' +
      '  COPY (SELECT * FROM \'file.parquet\') TO \'out.parquet\' (FORMAT PARQUET, CODEC \'SNAPPY\');\n\n' +
      '  # Python / PyArrow\n' +
      '  import pyarrow.parquet as pq\n' +
      '  pq.write_table(pq.read_table(\'file.parquet\'), \'out.parquet\', compression=\'snappy\')'
    )
  }
  return msg
}
