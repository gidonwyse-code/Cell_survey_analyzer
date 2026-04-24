import { useStore } from '../../store/useStore'
import type { Level } from '../../types'

const LEVELS: Level[] = ['TAZ_1270', 'TAZ_250', 'TAZ_33', 'TAZ_15', 'CITY']

export default function LevelSelector() {
  const { activeLevel, setLevel } = useStore()
  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Aggregation Level</div>
      <div className="flex flex-wrap gap-1">
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              activeLevel === l
                ? 'bg-sky-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}
