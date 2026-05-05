import { useStore } from '../../store/useStore'
import type { Mode, Direction } from '../../types'

const MODES: Array<{ value: Mode; label: string; minZones: number }> = [
  { value: 1, label: 'Single Zone',       minZones: 1 },
  { value: 2, label: 'Internal',          minZones: 2 },
  { value: 3, label: 'Group vs External', minZones: 2 },
  { value: 4, label: 'Combined',          minZones: 2 },
]

const DIRS: Array<{ value: Direction; label: string }> = [
  { value: 'outgoing', label: 'Outgoing' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'both',     label: 'Both' },
]

export default function ModeSelector() {
  const { activeMode, directionMode, selectedZoneIds, setMode, setDirectionMode } = useStore()
  const count = selectedZoneIds.size
  if (count === 0) return null

  const visibleModes = MODES.filter((m) => count >= m.minZones)

  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Visualization Mode</div>
      <div className="flex flex-col gap-1">
        {visibleModes.map((m) => {
          const disabled = m.value === 1 && count >= 2
          return (
            <button
              key={m.value}
              onClick={() => !disabled && setMode(m.value)}
              disabled={disabled}
              className={`w-full py-1.5 rounded text-xs font-medium text-left px-3 transition-colors ${
                disabled
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : activeMode === m.value
                  ? 'bg-sky-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Mode {m.value} — {m.label}
            </button>
          )
        })}
      </div>

      {(activeMode === 1 || activeMode === 3) && (
        <div className="mt-2">
          <div className="text-xs text-gray-500 mb-1">Direction</div>
          <div className="flex gap-1">
            {DIRS.map((d) => (
              <button
                key={d.value}
                onClick={() => setDirectionMode(d.value)}
                className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                  directionMode === d.value
                    ? 'bg-sky-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
