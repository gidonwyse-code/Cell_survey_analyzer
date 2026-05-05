import { useStore } from '../store/useStore'
import { useOD } from '../hooks/useOD'

export default function Legend() {
  const { activeLevel, activeMode, directionMode, selectedZoneIds, filters } = useStore()
  const od = useOD(activeLevel, activeMode, directionMode, selectedZoneIds, filters)
  if (selectedZoneIds.size === 0) return null

  const allRows = [...od.outgoing, ...od.incoming, ...od.internal]
  if (allRows.length === 0) return null

  const trips = allRows.map((r) => r.trips)
  const minT = Math.min(...trips)
  const maxT = Math.max(...trips)

  const filterSummary = [
    filters.day,
    `h${filters.hourMin}–h${filters.hourMax} (excl.)`,
    filters.minTrips !== 100 ? `min ${filters.minTrips} trips` : null,
  ].filter(Boolean).join(' · ')

  const colorEntries = [
    ...(od.outgoing.length > 0 ? [{ color: '#FC8181', label: 'Outgoing' }] : []),
    ...(od.incoming.length > 0 ? [{ color: '#6EE7B7', label: 'Incoming' }] : []),
    ...(od.internal.length > 0 ? [{ color: '#FB923C', label: 'Internal flows' }] : []),
  ]

  return (
    <div className="absolute bottom-6 right-3 bg-gray-900/90 backdrop-blur border border-gray-700 rounded-lg p-3 text-xs text-gray-300 space-y-2 min-w-[160px] z-10">
      {/* Color legend */}
      <div className="space-y-1">
        {colorEntries.map((e) => (
          <div key={e.label} className="flex items-center gap-2">
            <div className="w-6 h-1.5 rounded" style={{ backgroundColor: e.color }} />
            <span>{e.label}</span>
          </div>
        ))}
      </div>

      {/* Thickness scale */}
      <div className="space-y-0.5">
        <div className="text-gray-500 text-xs">Line width ∝ trips¹·⁵</div>
        <div className="flex items-end gap-1">
          <div className="w-8 bg-gray-400 rounded" style={{ height: '2px' }} />
          <span className="text-gray-500">{Math.round(minT).toLocaleString()} min</span>
          <div className="w-8 bg-gray-400 rounded" style={{ height: '14px' }} />
          <span className="text-gray-500">{Math.round(maxT).toLocaleString()} max</span>
        </div>
      </div>

      {/* Filter summary */}
      <div className="text-gray-500 border-t border-gray-700 pt-1">{filterSummary}</div>
    </div>
  )
}
