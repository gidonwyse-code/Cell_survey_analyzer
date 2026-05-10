import { useMemo, useState, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, Sector, ResponsiveContainer } from 'recharts'
import { useStore } from '../store/useStore'
import { useOD } from '../hooks/useOD'
import { useZones } from '../hooks/useZones'
import { exportPieChartData, buildZoneList } from '../utils/exportToExcel'
import type { ODRow } from '../types'

const SLICE_COLORS = [
  '#60A5FA', '#A78BFA', '#F472B6', '#34D399', '#FBBF24',
  '#F87171', '#38BDF8', '#C084FC', '#4ADE80', '#818CF8',
]
const OTHERS_COLOR = '#6B7280'

type TabId = 'overview' | 'outgoing' | 'incoming' | 'internal_origins' | 'internal_dests' | 'origin' | 'dest'

interface SliceData {
  id: string
  label: string
  trips: number
  fixedColor?: string
}

const ACCENT: Record<TabId, string> = {
  overview:         '#94A3B8',
  outgoing:         '#FC8181',
  incoming:         '#6EE7B7',
  internal_origins: '#FB923C',
  internal_dests:   '#FB923C',
  origin:           '#FB923C',
  dest:             '#FB923C',
}

function aggregate(
  rows: ODRow[],
  groupBy: 'origin_id' | 'dest_id',
  topN: number,
  labelMap: Map<string, string>,
): SliceData[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const key = row[groupBy]
    totals.set(key, (totals.get(key) ?? 0) + row.trips)
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, topN)
  const rest = sorted.slice(topN)
  const result: SliceData[] = top.map(([id, trips]) => ({
    id, label: labelMap.get(id) ?? id, trips,
  }))
  if (rest.length > 0) {
    result.push({
      id: 'others',
      label: `אחרים (${rest.length} אזורים)`,
      trips: rest.reduce((s, [, t]) => s + t, 0),
    })
  }
  return result
}

function sliceColor(d: SliceData, i: number): string {
  if (d.fixedColor) return d.fixedColor
  if (d.id === 'others') return OTHERS_COLOR
  return SLICE_COLORS[i % SLICE_COLORS.length]
}

interface ODResult {
  outgoing: ODRow[]
  incoming: ODRow[]
  internal: ODRow[]
}

function getSubtitleForTab(tabId: TabId, activeMode: number, zoneName: string): string {
  if (activeMode === 1) return tabId === 'outgoing' ? `יעדים מ-${zoneName}` : `מוצאים אל ${zoneName}`
  if (activeMode === 2) return tabId === 'origin' ? `אילו אזורים מייצרים נסיעות פנימיות — ${zoneName}` : `אילו אזורים מושכים נסיעות פנימיות — ${zoneName}`
  if (activeMode === 3) return tabId === 'outgoing' ? `יעדים חיצוניים מ-${zoneName}` : `מוצאים חיצוניים אל ${zoneName}`
  if (tabId === 'overview')         return `פילוג לפי סוג נסיעה — ${zoneName}`
  if (tabId === 'outgoing')         return `יעדים חיצוניים מ-${zoneName}`
  if (tabId === 'incoming')         return `מוצאים חיצוניים אל ${zoneName}`
  if (tabId === 'internal_origins') return `נסיעות פנימיות לפי אזור מוצא — ${zoneName}`
  if (tabId === 'internal_dests')   return `נסיעות פנימיות לפי אזור יעד — ${zoneName}`
  return ''
}

function getSlicesForTab(
  tabId: TabId,
  od: ODResult,
  topN: number,
  origLabelMap: Map<string, string>,
  destLabelMap: Map<string, string>,
  includeSelfLoops: boolean,
): SliceData[] {
  if (tabId === 'overview') {
    const slices: SliceData[] = [
      { id: 'outgoing', label: 'יוצא', trips: od.outgoing.reduce((s, r) => s + r.trips, 0), fixedColor: '#FC8181' },
      { id: 'incoming', label: 'נכנס', trips: od.incoming.reduce((s, r) => s + r.trips, 0), fixedColor: '#6EE7B7' },
    ]
    if (includeSelfLoops) {
      const interZone = od.internal.filter(r => r.origin_id !== r.dest_id).reduce((s, r) => s + r.trips, 0)
      const intraZone = od.internal.filter(r => r.origin_id === r.dest_id).reduce((s, r) => s + r.trips, 0)
      slices.push({ id: 'inter_selected', label: 'בין אזורים נבחרים', trips: interZone, fixedColor: '#FB923C' })
      slices.push({ id: 'intra_zone',     label: 'פנים אזורי',         trips: intraZone, fixedColor: '#FBBF24' })
    } else {
      slices.push({ id: 'internal', label: 'פנימי', trips: od.internal.reduce((s, r) => s + r.trips, 0), fixedColor: '#FB923C' })
    }
    return slices.filter(d => d.trips > 0)
  }
  if (tabId === 'outgoing')         return aggregate(od.outgoing, 'dest_id',   topN, destLabelMap)
  if (tabId === 'incoming')         return aggregate(od.incoming, 'origin_id', topN, origLabelMap)
  if (tabId === 'internal_origins') return aggregate(od.internal, 'origin_id', topN, origLabelMap)
  if (tabId === 'internal_dests')   return aggregate(od.internal, 'dest_id',   topN, destLabelMap)
  if (tabId === 'origin')           return aggregate(od.internal, 'origin_id', topN, origLabelMap)
  if (tabId === 'dest')             return aggregate(od.internal, 'dest_id',   topN, destLabelMap)
  return []
}

const RADIAN = Math.PI / 180
const RADIAL_EXT = 14  // px beyond pie edge for the elbow bend

export default function PieChartModal() {
  const {
    mapLevel, mapRole, counterpartLevel, activeMode, directionMode,
    selectedZoneIds, filters,
    isPieChartOpen, setPieChartOpen,
  } = useStore()

  const pieFilters = useMemo(() => ({ ...filters, minTrips: 1 }), [filters])
  const od = useOD(mapLevel, mapRole, counterpartLevel, activeMode, directionMode, selectedZoneIds, pieFilters)
  const { data: zonesData } = useZones(mapLevel)
  const { data: counterpartZonesData } = useZones(counterpartLevel)

  // labelMap for map-level zones (selected zones, and origin side when mapRole='origin')
  const labelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of zonesData?.features ?? []) {
      m.set(f.properties.id, f.properties.label)
    }
    return m
  }, [zonesData])

  // counterpartLabelMap for the other side
  const counterpartLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of counterpartZonesData?.features ?? []) {
      m.set(f.properties.id, f.properties.label)
    }
    return m
  }, [counterpartZonesData])

  // Resolve which label map corresponds to origins and destinations
  const origLabelMap = counterpartLabelMap
  const destLabelMap = mapRole === 'origin' ? counterpartLabelMap : labelMap

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const tabs = useMemo((): Array<{ id: TabId; label: string }> => {
    if (activeMode === 4) return [
      { id: 'overview',         label: 'סקירה' },
      { id: 'outgoing',         label: 'יוצא' },
      { id: 'incoming',         label: 'נכנס' },
      { id: 'internal_origins', label: 'פנימי-מוצאים' },
      { id: 'internal_dests',   label: 'פנימי-יעדים' },
    ]
    if (activeMode === 2) return [
      { id: 'origin', label: 'לפי מוצא' },
      { id: 'dest',   label: 'לפי יעד' },
    ]
    if (mapRole === 'destination') return []  // single incoming query, no tabs needed
    if (directionMode === 'both') return [
      { id: 'outgoing', label: 'יוצא' },
      { id: 'incoming', label: 'נכנס' },
    ]
    return []
  }, [activeMode, directionMode, mapRole])

  const defaultTab = useMemo((): TabId => {
    if (activeMode === 4) return 'overview'
    if (activeMode === 2) return 'origin'
    if (mapRole === 'destination') return 'incoming'
    if (directionMode === 'incoming') return 'incoming'
    return 'outgoing'
  }, [activeMode, directionMode, mapRole])

  const [tab, setTab] = useState<TabId>(defaultTab)
  const [topN, setTopN] = useState(10)
  const [topNInput, setTopNInput] = useState('10')
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  useEffect(() => { setTab(defaultTab) }, [defaultTab])
  useEffect(() => { setActiveIndex(null) }, [tab, topN])

  useEffect(() => {
    if (!isPieChartOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPieChartOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPieChartOpen, setPieChartOpen])

  // ── Zone name (used for subtitles) ───────────────────────────────────────
  const selectedZoneNames = useMemo(() =>
    [...selectedZoneIds].map(id => labelMap.get(id) ?? id),
    [selectedZoneIds, labelMap],
  )

  const zoneName = useMemo(() => {
    const ids = [...selectedZoneIds]
    if (ids.length === 1) return labelMap.get(ids[0]) ?? 'האזור הנבחר'
    return buildZoneList(ids, labelMap, 120)
  }, [selectedZoneIds, labelMap])

  // ── Pie data ──────────────────────────────────────────────────────────────
  const pieData = useMemo(
    () => getSlicesForTab(tab, od, topN, origLabelMap, destLabelMap, filters.includeSelfLoops),
    [tab, od, topN, origLabelMap, destLabelMap, filters.includeSelfLoops],
  )

  const allTabsData = useMemo(
    () => tabs.map(t => ({
      tabId: t.id,
      tabLabel: t.label,
      slices: getSlicesForTab(t.id, od, topN, origLabelMap, destLabelMap, filters.includeSelfLoops),
      subtitle: getSubtitleForTab(t.id, activeMode, zoneName),
    })),
    [tabs, od, topN, origLabelMap, destLabelMap, filters.includeSelfLoops, activeMode, zoneName],
  )

  const total = pieData.reduce((s, d) => s + d.trips, 0)
  const activeSlice = activeIndex !== null ? (pieData[activeIndex] ?? null) : null

  // ── Pre-compute label y-positions with anti-overlap ───────────────────────
  // renderLabel is called once per slice without knowing neighbours, so we
  // pre-compute all positions here and close over them in the callback.
  const labelPositions = useMemo(() => {
    if (!total) return new Map<number, number>()
    const MIN_GAP = 13     // minimum vertical gap (px) between adjacent baselines
    const outerRadius = 78 // must match <Pie outerRadius>
    const leftEntries:  Array<{ index: number; rawByRel: number }> = []
    const rightEntries: Array<{ index: number; rawByRel: number }> = []
    let accAngle = 0
    for (let i = 0; i < pieData.length; i++) {
      const percent = pieData[i].trips / total
      const sliceAngle = percent * 360
      const midAngle   = accAngle + sliceAngle / 2
      accAngle += sliceAngle
      if (percent < 0.05) continue
      const sin      = Math.sin(-midAngle * RADIAN)
      const cos      = Math.cos(-midAngle * RADIAN)
      const rawByRel = (outerRadius + RADIAL_EXT) * sin
      if (cos >= 0) rightEntries.push({ index: i, rawByRel })
      else          leftEntries.push({ index: i, rawByRel })
    }
    const result = new Map<number, number>()
    for (const side of [leftEntries, rightEntries]) {
      side.sort((a, b) => a.rawByRel - b.rawByRel)
      let lastY = -Infinity
      for (const entry of side) {
        const y = Math.max(entry.rawByRel, lastY + MIN_GAP)
        result.set(entry.index, y)
        lastY = y
      }
    }
    return result
  }, [pieData, total])

  const renderLabel = useCallback(
    ({ cx, cy, midAngle, innerRadius, outerRadius, percent, label, index }: any) => {
      if (percent < 0.05) return null
      const sin    = Math.sin(-midAngle * RADIAN)
      const cos    = Math.cos(-midAngle * RADIAN)
      const isRight = cos >= 0

      const midR  = (innerRadius + outerRadius) / 2
      const sx    = cx + (outerRadius + 3) * cos
      const sy    = cy + (outerRadius + 3) * sin
      const bx       = cx + (outerRadius + RADIAL_EXT) * cos
      const adjByRel = labelPositions.get(index)
      const adjBy    = adjByRel !== undefined ? cy + adjByRel : cy + (outerRadius + RADIAL_EXT) * sin

      const ex     = bx + (isRight ? 10 : -10)
      const anchor = isRight ? 'end' : 'start'
      const tx     = ex + (isRight ? 3 : -3)

      // Elbow line: diagonal radial segment to adjusted y → horizontal arm
      const pts = `${sx},${sy} ${bx},${adjBy} ${ex},${adjBy}`

      return (
        <g pointerEvents="none">
          <text
            x={cx + midR * cos} y={cy + midR * sin}
            fill="white" textAnchor="middle" dominantBaseline="central"
            fontSize={10} fontWeight="600"
          >
            {`${(percent * 100).toFixed(0)}%`}
          </text>
          <polyline points={pts} fill="none" stroke="#9CA3AF" strokeWidth={1} />
          <text x={tx} y={adjBy} fill="#374151" textAnchor={anchor} dominantBaseline="central" fontSize={10}>
            {label}
          </text>
        </g>
      )
    },
    [labelPositions],
  )

  // ── Filter description line ───────────────────────────────────────────────
  const DAY_LABEL: Record<string, string> = {
    weekday:  'יום חול',
    friday:   'יום שישי',
    saturday: 'יום שבת',
  }
  const dayLabel = DAY_LABEL[filters.day] ?? filters.day
  const timeLabel = (filters.hourMin === 0 && filters.hourMax === 24)
    ? 'סה"כ יומי'
    : `‪${filters.hourMin}–${filters.hourMax}‬`
  const filterLine = `${dayLabel} · ${timeLabel}`

  // ── Subtitle ──────────────────────────────────────────────────────────────
  const subtitle = useMemo(
    () => getSubtitleForTab(tab, activeMode, zoneName),
    [tab, activeMode, zoneName],
  )

  if (!isPieChartOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={() => setPieChartOpen(false)}
    >
      <div
        dir="rtl"
        className="bg-white border border-gray-200 rounded-xl w-[560px] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">פילוג נסיעות</h2>
            <p className="text-xs text-gray-600 mt-0.5">{filterLine}</p>
            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          </div>
          <button
            onClick={() => setPieChartOpen(false)}
            className="text-gray-400 hover:text-gray-700 text-base leading-none mt-0.5 px-1"
          >✕</button>
        </div>

        {/* Tabs */}
        {tabs.length > 0 && (
          <div className="flex gap-1.5 px-5 pt-3">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  tab === t.id ? 'text-gray-900' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                }`}
                style={tab === t.id ? { backgroundColor: ACCENT[t.id] } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Pie chart */}
        <div className="px-5 pt-4">
          {pieData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              אין נתונים לתצוגה זו
            </div>
          ) : (
            <div className="relative" onMouseDown={e => { e.preventDefault(); (document.activeElement as HTMLElement)?.blur() }}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={1}
                    dataKey="trips"
                    label={renderLabel}
                    labelLine={false}
                    isAnimationActive={false}
                    activeShape={(props: any) => <Sector {...props} />}
                    onMouseEnter={(_, index) => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                  >
                    {pieData.map((d, i) => (
                      <Cell key={d.id} fill={sliceColor(d, i)} stroke="white" strokeWidth={1} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Center label */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[88px] text-center flex flex-col items-center gap-0.5" dir="rtl">
                  {activeSlice ? (
                    <>
                      <span className="text-[10px] text-gray-500 leading-tight w-full truncate">{activeSlice.label}</span>
                      <span className="text-[14px] font-bold text-gray-900 leading-tight tabular-nums">
                        {Math.round(activeSlice.trips).toLocaleString()}
                      </span>
                      <span className="text-[10px] text-gray-400 leading-tight">
                        {total > 0 ? ((activeSlice.trips / total) * 100).toFixed(1) : '0'}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[9px] text-gray-400 leading-tight">סה״כ</span>
                      <span className="text-[14px] font-bold text-gray-900 leading-tight tabular-nums">
                        {Math.round(total).toLocaleString()}
                      </span>
                      <span className="text-[9px] text-gray-400 leading-tight">נסיעות</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-gray-200">
          <div className="flex items-center gap-3">
            {tab !== 'overview' && (
              <label className="flex items-center gap-2 text-xs text-gray-500">
                הצג
                <input
                  type="number"
                  min={3} max={20} value={topNInput}
                  onChange={e => setTopNInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  onBlur={() => {
                    const n = Math.max(3, Math.min(20, parseInt(topNInput, 10) || 3))
                    setTopN(n)
                    setTopNInput(String(n))
                  }}
                  className="w-12 bg-white text-gray-700 text-xs rounded px-2 py-0.5 border border-gray-300 focus:outline-none focus:border-sky-500 text-center"
                />
                אזורים מובילים
              </label>
            )}
            <button
              onClick={() => exportPieChartData({ allTabsData, filterLine, selectedZoneNames, filters })}
              disabled={pieData.length === 0}
              className="px-2.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ייצוא ל-Excel
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {'סה"כ: '}<span className="text-gray-700 font-medium">{Math.round(total).toLocaleString()}</span>{' נסיעות'}
          </p>
        </div>

        {/* Legend table */}
        {pieData.length > 0 && (
          <div className="px-5 pb-4 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {pieData.map((d, i) => {
                  const pct = total > 0 ? ((d.trips / total) * 100).toFixed(1) : '0'
                  return (
                    <tr key={d.id} className={`border-t border-gray-100 transition-colors ${i === activeIndex ? 'bg-sky-50' : ''}`}>
                      <td className="py-1.5 pl-2 w-5">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: sliceColor(d, i) }}
                        />
                      </td>
                      <td className="py-1.5 pl-4 text-gray-700 max-w-0 w-full truncate">{d.label}</td>
                      <td className="py-1.5 pl-3 text-left tabular-nums text-gray-500 whitespace-nowrap">
                        {Math.round(d.trips).toLocaleString()}
                      </td>
                      <td className="py-1.5 text-left tabular-nums text-gray-400 whitespace-nowrap w-12">
                        {pct}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
