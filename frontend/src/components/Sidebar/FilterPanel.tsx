import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'
import type { Day } from '../../types'

const DAYS: Array<{ value: Day; label: string }> = [
  { value: 'weekday',  label: 'Weekday' },
  { value: 'friday',   label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
]

export default function FilterPanel() {
  const { filters, setFilters, showFlowLabels, setShowFlowLabels, roundFlowLabels, setRoundFlowLabels, flowGradient, setFlowGradient, showArrows, setShowArrows } = useStore()
  const [local, setLocal] = useState(filters)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync if external state changes (e.g., level change resets)
  useEffect(() => { setLocal(filters) }, [filters])

  function apply(patch: Partial<typeof filters>) {
    const updated = { ...local, ...patch }
    setLocal(updated)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setFilters(updated), 400)
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400 uppercase tracking-wider">Filters</div>

      {/* Day */}
      <div>
        <div className="text-xs text-gray-500 mb-1">Day</div>
        <div className="flex flex-wrap gap-1">
          {DAYS.map((d) => (
            <button
              key={String(d.value)}
              onClick={() => apply({ day: d.value })}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                local.day === d.value
                  ? 'bg-sky-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hour range */}
      <div>
        <div className="text-xs text-gray-500 mb-1">
          Hour range: h{local.hourMin} – h{local.hourMax} (excl.)
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-6">From</span>
            <input
              type="range" min={0} max={23} value={local.hourMin}
              onChange={(e) => apply({ hourMin: Math.min(Number(e.target.value), local.hourMax) })}
              className="flex-1 h-1 accent-sky-500"
            />
            <span className="text-xs text-gray-400 w-4">{local.hourMin}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-6">To</span>
            <input
              type="range" min={0} max={24} value={local.hourMax}
              onChange={(e) => apply({ hourMax: Math.max(Number(e.target.value), local.hourMin) })}
              className="flex-1 h-1 accent-sky-500"
            />
            <span className="text-xs text-gray-400 w-4">{local.hourMax}</span>
          </div>
        </div>
      </div>

      {/* Min trips */}
      <div>
        <div className="text-xs text-gray-500 mb-1">Min trips</div>
        <input
          type="number" min={0} step={1} value={local.minTrips}
          onChange={(e) => apply({ minTrips: Math.max(0, Number(e.target.value)) })}
          className="w-full bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-sky-500"
        />
      </div>

      {/* Self loops */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox" checked={local.includeSelfLoops}
          onChange={(e) => apply({ includeSelfLoops: e.target.checked })}
          className="accent-sky-500"
        />
        <span className="text-xs text-gray-400">Include self-loops</span>
      </label>

      {/* Flow labels */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox" checked={showFlowLabels}
          onChange={(e) => setShowFlowLabels(e.target.checked)}
          className="accent-sky-500"
        />
        <span className="text-xs text-gray-400">Show trip counts on lines</span>
      </label>
      <label className={`flex items-center gap-2 cursor-pointer pr-0 ${!showFlowLabels ? 'opacity-40 pointer-events-none' : ''}`}>
        <span className="text-gray-600 select-none">↳</span>
        <input
          type="checkbox" checked={roundFlowLabels}
          onChange={(e) => setRoundFlowLabels(e.target.checked)}
          className="accent-sky-500"
          disabled={!showFlowLabels}
        />
        <span className="text-xs text-gray-400">Round counts (±10 / ±100)</span>
      </label>

      {/* Flow opacity gradient */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox" checked={flowGradient}
          onChange={(e) => setFlowGradient(e.target.checked)}
          className="accent-sky-500"
        />
        <span className="text-xs text-gray-400">Flow opacity gradient</span>
      </label>

      {/* Direction arrows */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox" checked={showArrows}
          onChange={(e) => setShowArrows(e.target.checked)}
          className="accent-sky-500"
        />
        <span className="text-xs text-gray-400">Show direction arrows</span>
      </label>
    </div>
  )
}
