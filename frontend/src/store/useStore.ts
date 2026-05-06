import { create } from 'zustand'
import type { Level, Mode, Direction, Basemap, Filters } from '../types'

interface AppState {
  mapLevel: Level
  mapRole: 'origin' | 'destination'
  counterpartLevel: Level
  activeMode: Mode
  directionMode: Direction
  selectedZoneIds: Set<string>
  filters: Filters
  hoveredZoneId: string | null
  hoveredFlowId: string | null
  activeBasemap: Basemap
  showFlowLabels: boolean
  flowGradient: boolean
  isPieChartOpen: boolean

  setMapLevel: (l: Level) => void
  setMapRole: (r: 'origin' | 'destination') => void
  setCounterpartLevel: (l: Level) => void
  setMode: (m: Mode) => void
  setDirectionMode: (d: Direction) => void
  toggleZone: (id: string, multi: boolean) => void
  clearZones: () => void
  removeZone: (id: string) => void
  setFilters: (f: Partial<Filters>) => void
  setHoveredZone: (id: string | null) => void
  setHoveredFlow: (id: string | null) => void
  setBasemap: (b: Basemap) => void
  setShowFlowLabels: (v: boolean) => void
  setFlowGradient: (v: boolean) => void
  setPieChartOpen: (v: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  mapLevel: 'TAZ_1270',
  mapRole: 'origin',
  counterpartLevel: 'TAZ_1270',
  activeMode: 1,
  directionMode: 'both',
  selectedZoneIds: new Set(),
  filters: { day: 'weekday', hourMin: 0, hourMax: 24, minTrips: 100, includeSelfLoops: false },
  hoveredZoneId: null,
  hoveredFlowId: null,
  activeBasemap: 'light',
  showFlowLabels: false,
  flowGradient: false,
  isPieChartOpen: false,

  setMapLevel: (l) => set({ mapLevel: l, counterpartLevel: l, selectedZoneIds: new Set(), activeMode: 1 }),
  setMapRole: (r) => set({ mapRole: r }),
  setCounterpartLevel: (l) => set((s) => ({
    counterpartLevel: l,
    activeMode: l !== s.mapLevel ? 1 : s.activeMode,
  })),
  setMode: (m) => set({ activeMode: m }),
  setDirectionMode: (d) => set({ directionMode: d }),

  toggleZone: (id, multi) =>
    set((s) => {
      const next = new Set(s.selectedZoneIds)
      if (!multi) {
        if (next.size === 1 && next.has(id)) {
          next.clear()
        } else {
          next.clear()
          next.add(id)
        }
      } else {
        next.has(id) ? next.delete(id) : next.add(id)
      }
      const mode: Mode = next.size >= 2 ? (s.activeMode === 1 ? 2 : s.activeMode) : 1
      return { selectedZoneIds: next, activeMode: mode }
    }),

  clearZones: () => set({ selectedZoneIds: new Set(), activeMode: 1 }),

  removeZone: (id) =>
    set((s) => {
      const next = new Set(s.selectedZoneIds)
      next.delete(id)
      const mode: Mode = next.size >= 2 ? s.activeMode : 1
      return { selectedZoneIds: next, activeMode: mode }
    }),

  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  setHoveredZone: (id) => set({ hoveredZoneId: id }),
  setHoveredFlow: (id) => set({ hoveredFlowId: id }),
  setBasemap: (b) => set({ activeBasemap: b }),
  setShowFlowLabels: (v) => set({ showFlowLabels: v }),
  setFlowGradient: (v) => set({ flowGradient: v }),
  setPieChartOpen: (v) => set({ isPieChartOpen: v }),
}))
