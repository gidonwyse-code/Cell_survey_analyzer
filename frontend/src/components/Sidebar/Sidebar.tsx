import { useMemo } from 'react'
import BasemapToggle from './BasemapToggle'
import LevelSelector from './LevelSelector'
import ModeSelector from './ModeSelector'
import FilterPanel from './FilterPanel'
import SelectedZonesList from './SelectedZonesList'
import { useStore } from '../../store/useStore'
import { useOD } from '../../hooks/useOD'
import { useZones } from '../../hooks/useZones'
import { exportODFlows } from '../../utils/exportToExcel'

export default function Sidebar() {
  const { mapLevel, mapRole, counterpartLevel, activeMode, directionMode, selectedZoneIds, filters, setPieChartOpen } = useStore()
  const od = useOD(mapLevel, mapRole, counterpartLevel, activeMode, directionMode, selectedZoneIds, filters)
  const { data: zonesData } = useZones(mapLevel)
  const { data: counterpartZonesData } = useZones(counterpartLevel)

  const labelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of [...(zonesData?.features ?? []), ...(counterpartZonesData?.features ?? [])]) {
      m.set(f.properties.id, f.properties.label)
    }
    return m
  }, [zonesData, counterpartZonesData])

  const selectedZoneNames = useMemo(() =>
    [...selectedZoneIds].map(id => labelMap.get(id) ?? id),
    [selectedZoneIds, labelMap],
  )

  const flowCount = od.outgoing.length + od.incoming.length + od.internal.length
  const totalTrips = Math.round(
    [...od.outgoing, ...od.incoming, ...od.internal].reduce((s, r) => s + r.trips, 0)
  )

  return (
    <aside className="w-80 flex-shrink-0 bg-gray-900 border-r border-gray-700 flex flex-col h-full overflow-y-auto">
      <div className="p-4 space-y-5 flex-1">
        <div className="pb-3 border-b border-gray-700">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 flex-shrink-0 rounded-full bg-sky-400" />
            <h1 className="text-sm font-semibold text-gray-200 tracking-wide">OD Flow Viewer</h1>
          </div>
        </div>

        <LevelSelector />
        <SelectedZonesList />
        <ModeSelector />
        <FilterPanel />
        <BasemapToggle />
      </div>

      {/* Status */}
      <div className="px-4 py-3 border-t border-gray-700 space-y-0.5">
        {selectedZoneIds.size === 0 ? (
          <p className="text-xs text-gray-600">Select zones on the map to visualize flows</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-400">{flowCount.toLocaleString()} flows · {totalTrips.toLocaleString()} trips</p>
              <div className="flex gap-1.5 flex-shrink-0">
                <button
                  onClick={() => setPieChartOpen(true)}
                  disabled={flowCount === 0}
                  className="px-2.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Chart
                </button>
                <button
                  onClick={() => exportODFlows({ outgoing: od.outgoing, incoming: od.incoming, internal: od.internal, labelMap, selectedZoneNames, filters, level: mapLevel, truncated: od.truncated })}
                  disabled={flowCount === 0}
                  className="px-2.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Export
                </button>
              </div>
            </div>
            {od.truncated && (
              <p className="text-xs text-amber-400">⚠ Showing top 5,000 flows (results truncated)</p>
            )}
            {od.isLoading && (
              <p className="text-xs text-sky-400 animate-pulse">Loading flows...</p>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
