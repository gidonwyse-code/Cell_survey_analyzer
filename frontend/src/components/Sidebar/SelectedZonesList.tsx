import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useZones } from '../../hooks/useZones'

export default function SelectedZonesList() {
  const { activeLevel, selectedZoneIds, removeZone, clearZones, toggleZone } = useStore()
  const { data: zonesData } = useZones(activeLevel)
  const [search, setSearch] = useState('')

  if (!zonesData) return null

  // Build id→label map
  const labelMap = new Map(zonesData.features.map((f) => [f.properties.id, f.properties.label]))

  const selectedList = [...selectedZoneIds].map((id) => ({ id, label: labelMap.get(id) ?? id }))

  const searchLower = search.toLowerCase()
  const suggestions = search.length >= 2
    ? zonesData.features
        .filter((f) =>
          !selectedZoneIds.has(f.properties.id) &&
          ((f.properties.label?.toLowerCase()?.includes(searchLower) ?? false) ||
           f.properties.id.toLowerCase().includes(searchLower))
        )
        .slice(0, 8)
    : []

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-400 uppercase tracking-wider">
          Selected Zones ({selectedZoneIds.size})
        </div>
        {selectedZoneIds.size > 0 && (
          <button onClick={clearZones} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
            Clear all
          </button>
        )}
      </div>

      {/* Search to add */}
      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search zones to add..."
          className="w-full bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-sky-500 placeholder-gray-500"
        />
        {suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-10 bg-gray-800 border border-gray-600 rounded mt-0.5 max-h-40 overflow-y-auto">
            {suggestions.map((f) => (
              <button
                key={f.properties.id}
                onClick={() => { toggleZone(f.properties.id, true); setSearch('') }}
                className="w-full text-left text-xs px-2 py-1 text-gray-300 hover:bg-gray-700 truncate"
              >
                {f.properties.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected list */}
      {selectedList.length === 0 ? (
        <p className="text-xs text-gray-600 italic">Click zones on the map to select</p>
      ) : (
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {selectedList.map(({ id, label }) => (
            <div key={id} className="flex items-center justify-between group bg-gray-700/50 rounded px-2 py-0.5">
              <span className="text-xs text-gray-300 truncate flex-1">{label}</span>
              <button
                onClick={() => removeZone(id)}
                className="text-gray-600 hover:text-red-400 ml-1 text-xs leading-none"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
