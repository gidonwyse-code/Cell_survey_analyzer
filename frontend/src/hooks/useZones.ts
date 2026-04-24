import { useQuery } from '@tanstack/react-query'
import type { Level } from '../types'

export interface ZoneGeoJSON {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: object
    properties: {
      id: string
      label: string
      centroid_lat: number
      centroid_lon: number
    }
  }>
}

export function useZones(level: Level) {
  return useQuery<ZoneGeoJSON>({
    queryKey: ['zones', level],
    queryFn: () => fetch(`/api/zones?level=${level}`).then((r) => r.json()),
    staleTime: Infinity,
  })
}
