import * as XLSX from 'xlsx'
import type { ODRow, Filters } from '../types'

interface SliceData {
  id: string
  label: string
  trips: number
  fixedColor?: string
}

function capitalizeDay(day: string): string {
  return day ? day.charAt(0).toUpperCase() + day.slice(1) : day
}

export function buildZoneList(ids: string[], labelMap: Map<string, string>, maxChars?: number): string {
  const names = ids.map(id => labelMap.get(id) ?? id)
  const full = names.join(', ')
  if (!maxChars || full.length <= maxChars) return full
  const shown: string[] = []
  for (const name of names) {
    const remaining = names.length - shown.length - 1
    const suffix = remaining > 0 ? `, and ${remaining} more zones` : ''
    const candidate = shown.length > 0
      ? `${shown.join(', ')}, ${name}${suffix}`
      : `${name}${suffix}`
    if (candidate.length <= maxChars) {
      shown.push(name)
    } else {
      break
    }
  }
  const remaining = names.length - shown.length
  if (remaining === 0) return shown.join(', ')
  if (shown.length === 0) return `and ${remaining} more zones`
  return `${shown.join(', ')}, and ${remaining} more zones`
}

function zoneRows(selectedZoneNames: string[]): string[][] {
  return selectedZoneNames.map((name, i) => [i === 0 ? 'Selected zones' : '', name])
}

function filterSummaryRows(filters: Filters, extra: Record<string, string | number> = {}) {
  return [
    ['Day', capitalizeDay(filters.day)],
    ['Hours', `${filters.hourMin}–${filters.hourMax}`],
    ['Min trips', filters.minTrips],
    ['Include self-loops', filters.includeSelfLoops ? 'Yes' : 'No'],
    ...Object.entries(extra).map(([k, v]) => [k, v]),
  ]
}

function internalType(r: ODRow): string {
  return r.origin_id === r.dest_id ? 'Self-loop' : 'Internal'
}

export function exportODFlows(params: {
  outgoing: ODRow[]
  incoming: ODRow[]
  internal: ODRow[]
  labelMap: Map<string, string>
  selectedZoneNames: string[]
  filters: Filters
  level: string
  truncated: boolean
}): void {
  const { outgoing, incoming, internal, labelMap, selectedZoneNames, filters, level, truncated } = params

  const resolve = (id: string) => labelMap.get(id) ?? id

  type FlowRow = { 'Origin ID': string; 'Origin name': string; 'Dest ID': string; 'Dest name': string; 'Trips': number; 'Type': string }
  const rows: FlowRow[] = [
    ...outgoing.map(r => ({ 'Origin ID': r.origin_id, 'Origin name': resolve(r.origin_id), 'Dest ID': r.dest_id, 'Dest name': resolve(r.dest_id), 'Trips': Math.round(r.trips), 'Type': 'Outgoing' })),
    ...incoming.map(r => ({ 'Origin ID': r.origin_id, 'Origin name': resolve(r.origin_id), 'Dest ID': r.dest_id, 'Dest name': resolve(r.dest_id), 'Trips': Math.round(r.trips), 'Type': 'Incoming' })),
    ...internal.map(r => ({ 'Origin ID': r.origin_id, 'Origin name': resolve(r.origin_id), 'Dest ID': r.dest_id, 'Dest name': resolve(r.dest_id), 'Trips': Math.round(r.trips), 'Type': internalType(r) })),
  ].sort((a, b) => b['Trips'] - a['Trips'])

  const totalTrips = rows.reduce((s, r) => s + r['Trips'], 0)

  const wb = XLSX.utils.book_new()

  const wsFlows = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, wsFlows, 'Flows')

  const summaryData = [
    ...filterSummaryRows(filters, {
      'Aggregation level': level,
      'Total flows': rows.length,
      'Total trips': totalTrips,
      ...(truncated ? { 'Warning': 'Result exceeded 5,000 rows — showing top 5,000 only' } : {}),
    }),
    ...zoneRows(selectedZoneNames),
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

  const filename = `od_flows_${level}_${filters.day}_${filters.hourMin}-${filters.hourMax}.xlsx`
  XLSX.writeFile(wb, filename)
}

export function exportPieChartData(params: {
  allTabsData: Array<{ tabId: string; tabLabel: string; slices: SliceData[]; subtitle: string }>
  filterLine: string
  selectedZoneNames: string[]
  filters: Filters
}): void {
  const { allTabsData, filterLine, selectedZoneNames, filters } = params

  const wb = XLSX.utils.book_new()

  for (const { tabLabel, slices, subtitle } of allTabsData) {
    if (slices.length === 0) continue
    const tabTotal = slices.reduce((s, d) => s + d.trips, 0)
    const dataRows = slices.map(d => [
      d.id === 'others' ? '—' : d.id,
      d.label,
      Math.round(d.trips),
      tabTotal > 0 ? +((d.trips / tabTotal) * 100).toFixed(1) : 0,
    ])
    const roundedTotal = dataRows.reduce((s, r) => s + (r[2] as number), 0)

    const aoa = [
      [subtitle],
      [filterLine],
      ['Include self-loops', filters.includeSelfLoops ? 'Yes' : 'No'],
      ...zoneRows(selectedZoneNames),
      [],
      ['Zone ID', 'Zone name', 'Trips', 'Share (%)'],
      ...dataRows,
      ['', 'Total', roundedTotal, 100],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wb, ws, tabLabel.slice(0, 31))
  }

  const filename = `pie_chart_${filters.day}_${filters.hourMin}-${filters.hourMax}.xlsx`
  XLSX.writeFile(wb, filename)
}
