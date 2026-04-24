import { create } from 'zustand'
import type { Level, Mode, Direction, Basemap, Filters } from '../types'

interface AppState {
  activeLevel: Level
  activeMode: Mode
  directionMode: Direction
  selectedZoneIds: Set<string>
  filters: Filters
  hoveredZoneId: string | null
  hoveredFlowId: string | null
  activeBasemap: Basemap

  setLevel: (l: Level) => void
  setMode: (m: Mode) => void
  setDirectionMode: (d: Direction) => void
  toggleZone: (id: string, multi: boolean) => void
  clearZones: () => void
  removeZone: (id: string) => void
  setFilters: (f: Partial<Filters>) => void
  setHoveredZone: (id: string | null) => void
  setHoveredFlow: (id: string | null) => void
  setBasemap: (b: Basemap) => void
}

export const useStore = create<AppState>((set) => ({
  activeLevel: 'TAZ_1270',
  activeMode: 1,
  directionMode: 'both',
  selectedZoneIds: new Set(),
  filters: { day: null, hourMin: 0, hourMax: 23, minTrips: 100, includeSelfLoops: false },
  hoveredZoneId: null,
  hoveredFlowId: null,
  activeBasemap: 'light',

  setLevel: (l) => set({ activeLevel: l, selectedZoneIds: new Set(), activeMode: 1 }),
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
}))
