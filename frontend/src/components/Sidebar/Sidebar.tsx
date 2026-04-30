import BasemapToggle from './BasemapToggle'
import LevelSelector from './LevelSelector'
import ModeSelector from './ModeSelector'
import FilterPanel from './FilterPanel'
import SelectedZonesList from './SelectedZonesList'
import { useStore } from '../../store/useStore'
import { useOD } from '../../hooks/useOD'

export default function Sidebar() {
  const { activeLevel, activeMode, directionMode, selectedZoneIds, filters } = useStore()
  const od = useOD(activeLevel, activeMode, directionMode, selectedZoneIds, filters)

  const flowCount = od.outgoing.length + od.incoming.length + od.internal.length
  const totalTrips = Math.round(
    [...od.outgoing, ...od.incoming, ...od.internal].reduce((s, r) => s + r.trips, 0)
  )

  return (
    <aside className="w-80 flex-shrink-0 bg-gray-900 border-r border-gray-700 flex flex-col h-full overflow-y-auto">
      <div className="p-4 space-y-5 flex-1">
        <div className="flex items-center gap-2 pb-2 border-b border-gray-700">
          <div className="w-2 h-2 rounded-full bg-sky-400" />
          <h1 className="text-sm font-semibold text-gray-200 tracking-wide">OD Viewer</h1>
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
            <p className="text-xs text-gray-400">{flowCount.toLocaleString()} flows · {totalTrips.toLocaleString()} trips</p>
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
