export type Level = string
export type Mode = 1 | 2 | 3 | 4
export type Direction = 'outgoing' | 'incoming' | 'both'
export type Basemap = 'dark' | 'light' | 'osm'
export type Day = string

export interface LevelMeta {
  id: string
  name: string
}

export interface Filters {
  day: Day
  hourMin: number
  hourMax: number
  minTrips: number
  includeSelfLoops: boolean
}

export interface ZoneFeature {
  id: string
  label: string
  centroid_lat: number
  centroid_lon: number
}

export interface ODRow {
  origin_id: string
  dest_id: string
  trips: number
}

export interface ODResponse {
  data: ODRow[]
  truncated: boolean
}

export interface Metadata {
  days: string[]
  hours: { min: number; max: number }
  trips: { min: number; max: number }
  levels: LevelMeta[]
  bbox: [number, number, number, number]
}
