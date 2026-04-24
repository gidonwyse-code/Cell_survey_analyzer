import { useStore } from '../../store/useStore'
import type { Basemap } from '../../types'

const OPTIONS: Array<{ value: Basemap; label: string; title: string }> = [
  { value: 'dark',  label: 'Dark',  title: 'CartoDB Dark Matter' },
  { value: 'light', label: 'Light', title: 'CartoDB Positron' },
  { value: 'osm',   label: 'OSM',   title: 'OpenStreetMap' },
]

export default function BasemapToggle() {
  const { activeBasemap, setBasemap } = useStore()
  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Basemap</div>
      <div className="flex gap-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            title={o.title}
            onClick={() => setBasemap(o.value)}
            className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
              activeBasemap === o.value
                ? 'bg-sky-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
