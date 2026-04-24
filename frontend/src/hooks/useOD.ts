import { useQueries } from '@tanstack/react-query'
import type { Filters, Level, Mode, Direction, ODRow } from '../types'

interface ODParams {
  level: Level
  filters: Filters
  originIds?: string[]
  destIds?: string[]
  excludeOriginIds?: string[]
  excludeDestIds?: string[]
}

function buildUrl(params: ODParams): string {
  const p = new URLSearchParams({ level: params.level })
  if (params.filters.day) p.set('day', params.filters.day)
  p.set('hour_min', String(params.filters.hourMin))
  p.set('hour_max', String(params.filters.hourMax))
  p.set('min_trips', String(params.filters.minTrips))
  if (params.filters.includeSelfLoops) p.set('include_self_loops', 'true')
  if (params.originIds?.length) p.set('origin_ids', params.originIds.join(','))
  if (params.destIds?.length) p.set('dest_ids', params.destIds.join(','))
  if (params.excludeOriginIds?.length) p.set('exclude_origin_ids', params.excludeOriginIds.join(','))
  if (params.excludeDestIds?.length) p.set('exclude_dest_ids', params.excludeDestIds.join(','))
  return `/api/od?${p}`
}

async function fetchOD(url: string): Promise<{ data: ODRow[]; truncated: boolean }> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`OD fetch failed: ${r.status}`)
  return r.json()
}

export interface ODResult {
  internal: ODRow[]
  external: ODRow[]
  truncated: boolean
  isLoading: boolean
}

export function useOD(
  level: Level,
  mode: Mode,
  direction: Direction,
  selectedZoneIds: Set<string>,
  filters: Filters,
): ODResult {
  const ids = [...selectedZoneIds]
  const enabled = ids.length > 0

  // Build query specs for each mode
  const queries: Array<{ url: string; tag: 'internal' | 'external' }> = []

  if (enabled) {
    if (mode === 1) {
      if (direction === 'outgoing' || direction === 'both') {
        queries.push({ url: buildUrl({ level, filters, originIds: ids }), tag: 'internal' })
      }
      if (direction === 'incoming' || direction === 'both') {
        queries.push({ url: buildUrl({ level, filters, destIds: ids }), tag: 'internal' })
      }
    } else if (mode === 2) {
      queries.push({ url: buildUrl({ level, filters, originIds: ids, destIds: ids }), tag: 'internal' })
    } else if (mode === 3) {
      if (direction === 'outgoing' || direction === 'both') {
        queries.push({ url: buildUrl({ level, filters, originIds: ids, excludeDestIds: ids }), tag: 'external' })
      }
      if (direction === 'incoming' || direction === 'both') {
        queries.push({ url: buildUrl({ level, filters, destIds: ids, excludeOriginIds: ids }), tag: 'external' })
      }
    } else if (mode === 4) {
      // Internal (Mode 2 logic)
      queries.push({ url: buildUrl({ level, filters, originIds: ids, destIds: ids }), tag: 'internal' })
      // External outgoing + incoming (Mode 3 both)
      queries.push({ url: buildUrl({ level, filters, originIds: ids, excludeDestIds: ids }), tag: 'external' })
      queries.push({ url: buildUrl({ level, filters, destIds: ids, excludeOriginIds: ids }), tag: 'external' })
    }
  }

  const results = useQueries({
    queries: queries.map(({ url, tag }) => ({
      queryKey: ['od', url],
      queryFn: () => fetchOD(url),
      enabled,
      staleTime: 30_000,
      meta: { tag },
    })),
  })

  const internal: ODRow[] = []
  const external: ODRow[] = []
  let truncated = false
  let isLoading = false

  results.forEach((r, i) => {
    if (r.isLoading) isLoading = true
    if (r.data) {
      if (r.data.truncated) truncated = true
      if (queries[i].tag === 'internal') internal.push(...r.data.data)
      else external.push(...r.data.data)
    }
  })

  // For Mode 1 Both: deduplicate merged flows by origin+dest key
  const deduped = (rows: ODRow[]): ODRow[] => {
    if (rows.length === 0) return rows
    const map = new Map<string, ODRow>()
    for (const row of rows) {
      const key = `${row.origin_id}|${row.dest_id}`
      const existing = map.get(key)
      if (existing) {
        map.set(key, { ...existing, trips: existing.trips + row.trips })
      } else {
        map.set(key, row)
      }
    }
    return [...map.values()]
  }

  return {
    internal: deduped(internal),
    external: deduped(external),
    truncated,
    isLoading,
  }
}
