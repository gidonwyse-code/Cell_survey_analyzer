export type Level = 'TAZ_1270' | 'TAZ_250' | 'TAZ_33' | 'TAZ_15' | 'CITY'
export type Mode = 1 | 2 | 3 | 4
export type Direction = 'outgoing' | 'incoming' | 'both'
export type Basemap = 'dark' | 'light' | 'osm'
export type Day = 'weekday' | 'friday' | 'saturday'

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
  levels: Level[]
}
