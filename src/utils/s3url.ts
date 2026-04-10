/**
 * Normalize any supported URL input to a plain HTTPS URL.
 * s3://bucket/key  →  https://bucket.s3.amazonaws.com/key
 * https://...      →  unchanged (trimmed)
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (trimmed.startsWith('s3://')) {
    const withoutScheme = trimmed.slice(5)
    const slashIdx = withoutScheme.indexOf('/')
    if (slashIdx === -1) {
      return `https://${withoutScheme}.s3.amazonaws.com/`
    }
    const bucket = withoutScheme.slice(0, slashIdx)
    const key = withoutScheme.slice(slashIdx)
    return `https://${bucket}.s3.amazonaws.com${key}`
  }
  return trimmed
}

export function isValidUrl(input: string): boolean {
  const normalized = normalizeUrl(input)
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
