import { useStore } from '../../store/useStore'
import type { Level } from '../../types'

const LEVELS: Level[] = ['TAZ_1270', 'TAZ_250', 'TAZ_33', 'TAZ_15', 'CITY']

function LevelButtons({ active, onChange }: { active: Level; onChange: (l: Level) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {LEVELS.map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            active === l
              ? 'bg-sky-500 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export default function LevelSelector() {
  const { mapLevel, mapRole, counterpartLevel, setMapLevel, setMapRole, setCounterpartLevel } = useStore()

  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Map Level</div>
        <LevelButtons active={mapLevel} onChange={setMapLevel} />
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
        <LevelButtons active={counterpartLevel} onChange={setCounterpartLevel} />
      </div>
    </div>
  )
}
