import { useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { useMetadata } from '../../hooks/useMetadata'
import type { LevelMeta } from '../../types'

function LevelButtons({
  levels,
  active,
  onChange,
}: {
  levels: LevelMeta[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {levels.map((lv) => (
        <button
          key={lv.id}
          onClick={() => onChange(lv.id)}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            active === lv.id
              ? 'bg-sky-500 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          {lv.name}
        </button>
      ))}
    </div>
  )
}

export default function LevelSelector() {
  const { mapLevel, mapRole, counterpartLevel, setMapLevel, setMapRole, setCounterpartLevel } = useStore()
  const { data: metadata } = useMetadata()
  const levels = metadata?.levels ?? []

  // Initialize to first level when metadata loads and no level is set yet
  useEffect(() => {
    if (!mapLevel && levels.length > 0) {
      setMapLevel(levels[0].id)
    }
  }, [mapLevel, levels, setMapLevel])

  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Map Level</div>
        <LevelButtons levels={levels} active={mapLevel} onChange={setMapLevel} />
      </div>

      <div>
        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Map Zones Are</div>
        <div className="flex gap-1">
          {(['origin', 'destination'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setMapRole(r)}
              className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                mapRole === r
                  ? 'bg-sky-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {r === 'origin' ? 'Origins' : 'Destinations'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Counterpart Level</div>
        <LevelButtons levels={levels} active={counterpartLevel} onChange={setCounterpartLevel} />
      </div>
    </div>
  )
}
