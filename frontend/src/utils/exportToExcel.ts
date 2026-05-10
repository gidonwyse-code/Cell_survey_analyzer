import * as XLSX from 'xlsx'
import type { ODRow, Filters } from '../types'

interface SliceData {
  id: string
  label: string
  trips: number
  fixedColor?: string
}

const DAY_LABEL: Record<string, string> = {
  weekday:  'יום חול',
  friday:   'יום שישי',
  saturday: 'יום שבת',
}

export function buildZoneList(ids: string[], labelMap: Map<string, string>, maxChars?: number): string {
  const names = ids.map(id => labelMap.get(id) ?? id)
  const full = names.join(', ')
  if (!maxChars || full.length <= maxChars) return full
  const shown: string[] = []
  for (const name of names) {
    const remaining = names.length - shown.length - 1
    const suffix = remaining > 0 ? `, ועוד ${remaining} אזורים` : ''
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
  if (shown.length === 0) return `ועוד ${remaining} אזורים`
  return `${shown.join(', ')}, ועוד ${remaining} אזורים`
}

function zoneRows(selectedZoneNames: string[]): string[][] {
  return selectedZoneNames.map((name, i) => [i === 0 ? 'אזורים נבחרים' : '', name])
}

function filterSummaryRows(filters: Filters, extra: Record<string, string | number> = {}) {
  return [
    ['יום', DAY_LABEL[filters.day] ?? filters.day],
    ['שעות', `${filters.hourMin}–${filters.hourMax}`],
    ['מינימום נסיעות', filters.minTrips],
    ['כולל נסיעות פנים-אזוריות', filters.includeSelfLoops ? 'כן' : 'לא'],
    ...Object.entries(extra).map(([k, v]) => [k, v]),
  ]
}

function internalType(r: ODRow): string {
  return r.origin_id === r.dest_id ? 'פנים אזורי' : 'בין אזורים נבחרים'
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

  type FlowRow = { 'מזהה מוצא': string; 'שם מוצא': string; 'מזהה יעד': string; 'שם יעד': string; 'נסיעות': number; 'סוג': string }
  const rows: FlowRow[] = [
    ...outgoing.map(r => ({ 'מזהה מוצא': r.origin_id, 'שם מוצא': resolve(r.origin_id), 'מזהה יעד': r.dest_id, 'שם יעד': resolve(r.dest_id), 'נסיעות': Math.round(r.trips), 'סוג': 'יוצא' })),
    ...incoming.map(r => ({ 'מזהה מוצא': r.origin_id, 'שם מוצא': resolve(r.origin_id), 'מזהה יעד': r.dest_id, 'שם יעד': resolve(r.dest_id), 'נסיעות': Math.round(r.trips), 'סוג': 'נכנס' })),
    ...internal.map(r => ({ 'מזהה מוצא': r.origin_id, 'שם מוצא': resolve(r.origin_id), 'מזהה יעד': r.dest_id, 'שם יעד': resolve(r.dest_id), 'נסיעות': Math.round(r.trips), 'סוג': internalType(r) })),
  ].sort((a, b) => b['נסיעות'] - a['נסיעות'])

  const totalTrips = rows.reduce((s, r) => s + r['נסיעות'], 0)

  const wb = XLSX.utils.book_new()
  wb.Workbook = { Views: [{ RTL: true }] }

  const wsFlows = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, wsFlows, 'נסיעות')

  const summaryData = [
    ...filterSummaryRows(filters, {
      'רמת אגרגציה': level,
      'סה"כ זרימות': rows.length,
      'סה"כ נסיעות': totalTrips,
      ...(truncated ? { 'אזהרה': 'הנתונים גדולים מ-5,000 שורות — מוצגות 5,000 הגדולות בלבד' } : {}),
    }),
    ...zoneRows(selectedZoneNames),
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(wb, wsSummary, 'סיכום')

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
  wb.Workbook = { Views: [{ RTL: true }] }

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
      ['כולל נסיעות פנים-אזוריות', filters.includeSelfLoops ? 'כן' : 'לא'],
      ...zoneRows(selectedZoneNames),
      [],
      ['מזהה אזור', 'שם אזור', 'נסיעות', 'אחוז (%)'],
      ...dataRows,
      ['', 'סה"כ', roundedTotal, 100],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wb, ws, tabLabel.slice(0, 31))
  }

  const filename = `pie_chart_${DAY_LABEL[filters.day] ?? filters.day}_${filters.hourMin}-${filters.hourMax}.xlsx`
  XLSX.writeFile(wb, filename)
}
