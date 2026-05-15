import { useQueries } from '@tanstack/react-query'
import type { Filters, Level, Mode, Direction, ODRow } from '../types'

interface ODParams {
  originLevel: Level
  destLevel: Level
  filters: Filters
  originIds?: string[]
  destIds?: string[]
  excludeOriginIds?: string[]
  excludeDestIds?: string[]
}

function buildUrl(params: ODParams): string {
  const p = new URLSearchParams()
  if (params.originLevel === params.destLevel) {
    p.set('level', params.originLevel)
  } else {
    p.set('origin_level', params.originLevel)
    p.set('dest_level', params.destLevel)
  }
  p.set('day', params.filters.day)
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
  outgoing: ODRow[]
  incoming: ODRow[]
  internal: ODRow[]
  truncated: boolean
  isLoading: boolean
}

export function useOD(
  mapLevel: Level,
  mapRole: 'origin' | 'destination',
  counterpartLevel: Level,
  mode: Mode,
  direction: Direction,
  selectedZoneIds: Set<string>,
  filters: Filters,
): ODResult {
  const ids = [...selectedZoneIds]
  const enabled = ids.length > 0 && !!mapLevel && !!counterpartLevel

  // Build query specs for each mode
  const queries: Array<{ url: string; tag: 'outgoing' | 'incoming' | 'internal' }> = []

  if (enabled) {
    if (mapRole === 'destination') {
      // Selected zones are destinations; query flows FROM counterpart origins TO them
      queries.push({
        url: buildUrl({ originLevel: counterpartLevel, destLevel: mapLevel, filters, destIds: ids }),
        tag: 'incoming',
      })
    } else if (mode === 1) {
      if (direction === 'outgoing' || direction === 'both') {
        queries.push({
          url: buildUrl({ originLevel: mapLevel, destLevel: counterpartLevel, filters, originIds: ids }),
          tag: 'outgoing',
        })
      }
      if (direction === 'incoming' || direction === 'both') {
        queries.push({
          url: buildUrl({ originLevel: counterpartLevel, destLevel: mapLevel, filters, destIds: ids }),
          tag: 'incoming',
        })
      }
    } else if (mode === 2) {
      queries.push({ url: buildUrl({ originLevel: mapLevel, destLevel: mapLevel, filters, originIds: ids, destIds: ids }), tag: 'internal' })
    } else if (mode === 3) {
      if (direction === 'outgoing' || direction === 'both') {
        queries.push({ url: buildUrl({ originLevel: mapLevel, destLevel: mapLevel, filters, originIds: ids, excludeDestIds: ids }), tag: 'outgoing' })
      }
      if (direction === 'incoming' || direction === 'both') {
        queries.push({ url: buildUrl({ originLevel: mapLevel, destLevel: mapLevel, filters, destIds: ids, excludeOriginIds: ids }), tag: 'incoming' })
      }
    } else if (mode === 4) {
      queries.push({ url: buildUrl({ originLevel: mapLevel, destLevel: mapLevel, filters, originIds: ids, destIds: ids }), tag: 'internal' })
      queries.push({ url: buildUrl({ originLevel: mapLevel, destLevel: mapLevel, filters, originIds: ids, excludeDestIds: ids }), tag: 'outgoing' })
      queries.push({ url: buildUrl({ originLevel: mapLevel, destLevel: mapLevel, filters, destIds: ids, excludeOriginIds: ids }), tag: 'incoming' })
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

  const outgoing: ODRow[] = []
  const incoming: ODRow[] = []
  const internal: ODRow[] = []
  let truncated = false
  let isLoading = false

  results.forEach((r, i) => {
    if (r.isLoading) isLoading = true
    if (r.data) {
      if (r.data.truncated) truncated = true
      const tag = queries[i].tag
      if (tag === 'outgoing') outgoing.push(...r.data.data)
      else if (tag === 'incoming') incoming.push(...r.data.data)
      else internal.push(...r.data.data)
    }
  })

  return {
    outgoing,
    incoming,
    internal,
    truncated,
    isLoading,
  }
}
