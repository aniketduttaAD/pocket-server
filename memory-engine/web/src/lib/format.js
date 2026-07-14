import { format, parseISO, isValid } from 'date-fns'

export function formatBytes(bytes, decimals = 2) {
  if (!bytes) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function formatDate(dateStr, pattern = 'MMMM d, yyyy') {
  if (!dateStr) return 'Date unknown'
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr
    if (!isValid(d)) return dateStr
    return format(d, pattern)
  } catch {
    return dateStr
  }
}

export function formatShortDate(dateStr) {
  return formatDate(dateStr, 'MMM d, yyyy')
}

export function formatYearMonth(year, month) {
  const d = new Date(year, month - 1, 1)
  return format(d, 'MMMM yyyy')
}

export function parseSceneTags(tags) {
  if (!tags) return []
  if (Array.isArray(tags)) return tags
  try {
    return JSON.parse(tags)
  } catch {
    return tags ? [tags] : []
  }
}
