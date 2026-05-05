import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

maplibregl.setRTLTextPlugin(
  'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
  null,
  true,
)
import { useStore } from '../../store/useStore'
import { useZones } from '../../hooks/useZones'
import { useOD } from '../../hooks/useOD'
import type { ODRow } from '../../types'
import { addArrowImages } from './arrowIcon'

// MapLibre does not support {s} or {r} placeholders — use explicit subdomain URLs
const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd']
const cartoTiles = (style: string) =>
  CARTO_SUBDOMAINS.map((s) => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`)

const BASEMAP_TILES: Record<string, string[]> = {
  dark:  cartoTiles('dark_all'),
  light: cartoTiles('light_all'),
  osm:   ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
}

const ATTRIBUTIONS: Record<string, string> = {
  dark:  '© OpenStreetMap contributors © CARTO',
  light: '© OpenStreetMap contributors © CARTO',
  osm:   '© OpenStreetMap contributors',
}

function haversineBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

const GAP_PX = 1.5   // half-gap between opposing line edges; total visual gap = 2 × GAP_PX
const ARROW_SIZE = 0.8  // must match icon-size in the layer definition

function buildFlowFeatures(
  rows: ODRow[],
  centroidMap: Map<string, { lat: number; lon: number; label: string }>,
  applyOffset: boolean,
) {
  const features: GeoJSON.Feature[] = []
  const arrowFeatures: GeoJSON.Feature[] = []
  if (rows.length === 0) return { features, arrowFeatures }

  const trips = rows.map((r) => r.trips)
  const maxT = Math.max(...trips)
  const powMax = Math.pow(maxT, 1.5) || 1

  for (const row of rows) {
    const orig = centroidMap.get(row.origin_id)
    const dest = centroidMap.get(row.dest_id)
    if (!orig || !dest) continue

    const width = 2 + (Math.pow(row.trips, 1.5) / powMax) * 12
    const bearing = haversineBearing(orig.lat, orig.lon, dest.lat, dest.lon)
    // Offset each line by half its own width plus the gap, so opposing edges
    // are always separated by exactly 2 × GAP_PX regardless of line thickness
    const offset = applyOffset ? width / 2 + GAP_PX : 0
    const iconOffset: [number, number] = applyOffset ? [offset / ARROW_SIZE, 0] : [0, 0]

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[orig.lon, orig.lat], [dest.lon, dest.lat]],
      },
      properties: {
        origin_id: row.origin_id,
        dest_id: row.dest_id,
        trips: row.trips,
        width,
        offset,
        bearing,
        orig_label: orig.label,
        dest_label: dest.label,
      },
    })

    arrowFeatures.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          orig.lon + 0.75 * (dest.lon - orig.lon),
          orig.lat + 0.75 * (dest.lat - orig.lat),
        ],
      },
      properties: { bearing, iconOffset },
    })
  }

  return { features, arrowFeatures }
}

function toGeoJSON(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features }
}

function setSource(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as maplibregl.GeoJSONSource)?.setData(data)
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const tooltipRef = useRef<maplibregl.Popup | null>(null)
  const hoveredIdxRef = useRef<number | null | undefined>(null)
  const initialFitRef = useRef(false)
  // idx↔zoneId mapping built by the data-load effect, read by the selection effect
  const zoneFeaturesRef = useRef<Array<{ idx: number; zoneId: string }>>([])
  // mapReady flips to true when the map 'load' event fires — all data effects depend on it
  const [mapReady, setMapReady] = useState(false)

  const {
    activeLevel, activeMode, directionMode,
    selectedZoneIds, filters, activeBasemap,
    showFlowLabels,
    toggleZone,
  } = useStore()

  const { data: zonesData } = useZones(activeLevel)
  const od = useOD(activeLevel, activeMode, directionMode, selectedZoneIds, filters)

  // Centroid lookup for flow line drawing
  const centroidMap = useRef(new Map<string, { lat: number; lon: number; label: string }>())
  useEffect(() => {
    if (!zonesData) return
    const m = new Map<string, { lat: number; lon: number; label: string }>()
    for (const f of zonesData.features) {
      const p = f.properties
      m.set(p.id, { lat: p.centroid_lat, lon: p.centroid_lon, label: p.label })
    }
    centroidMap.current = m
  }, [zonesData])

  // ── Initialize map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        sources: {
          'basemap-source': {
            type: 'raster',
            tiles: BASEMAP_TILES.light,
            tileSize: 256,
            attribution: ATTRIBUTIONS.light,
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap-source' }],
      },
      center: [34.85, 31.5],
      zoom: 7,
      boxZoom: false,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      addArrowImages(map)

      // Zone polygon layers
      map.addSource('zones', { type: 'geojson', data: toGeoJSON([]), promoteId: 'idx' })
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 'rgba(56,189,248,0.50)',
            ['boolean', ['feature-state', 'hovered'], false], 'rgba(56,189,248,0.20)',
            'rgba(0,0,0,0.04)',
          ],
          'fill-opacity': 1,
        },
      })
      map.addLayer({
        id: 'zones-outline',
        type: 'line',
        source: 'zones',
        paint: { 'line-color': 'rgba(0,0,0,0.25)', 'line-width': 0.8 },
      })

      // Flow line layers
      for (const tag of ['outgoing', 'incoming', 'internal'] as const) {
        const color = tag === 'outgoing' ? '#FC8181' : tag === 'incoming' ? '#6EE7B7' : '#FB923C'
        map.addSource(`flows-${tag}`, { type: 'geojson', data: toGeoJSON([]) })
        map.addLayer({
          id: `flows-${tag}-line`,
          type: 'line',
          source: `flows-${tag}`,
          minzoom: 5,
          paint: {
            'line-color': color,
            'line-width': ['get', 'width'],
            'line-offset': ['get', 'offset'],
            'line-opacity': 0.75,
          },
        })
        map.addSource(`arrows-${tag}`, { type: 'geojson', data: toGeoJSON([]) })
        map.addLayer({
          id: `flows-${tag}-arrows`,
          type: 'symbol',
          source: `arrows-${tag}`,
          minzoom: 5,
          layout: {
            'icon-image': `arrow-${tag}`,
            'icon-rotate': ['get', 'bearing'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-size': ARROW_SIZE,
            'icon-offset': ['get', 'iconOffset'],
          },
          paint: { 'icon-opacity': 0.85 },
        })
        map.addLayer({
          id: `flows-${tag}-labels`,
          type: 'symbol',
          source: `flows-${tag}`,
          minzoom: 5,
          layout: {
            'symbol-placement': 'line-center',
            'text-field': ['to-string', ['round', ['get', 'trips']]],
            'text-font': ['Klokantech Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 0.8],
            'text-keep-upright': true,
            'text-allow-overlap': false,
            'visibility': 'none',
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#111111',
            'text-halo-width': 1.5,
          },
        })
      }

      // Zone label points — added AFTER flow layers so labels render above lines
      map.addSource('zone-labels', { type: 'geojson', data: toGeoJSON([]) })
      map.addLayer({
        id: 'zones-labels',
        type: 'symbol',
        source: 'zone-labels',
        minzoom: 8,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Klokantech Noto Sans Regular'],
          'text-size': 10,
          'text-anchor': 'center',
          'text-max-width': 8,
        },
        paint: {
          'text-color': '#1a1a2e',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      })

      // Zone click / hover
      map.on('click', 'zones-fill', (e) => {
        if (!e.features?.length) return
        toggleZone(String(e.features[0].properties.id), e.originalEvent.shiftKey)
      })
      map.on('mousemove', 'zones-fill', (e) => {
        if (!e.features?.length) return
        map.getCanvas().style.cursor = 'pointer'
        const props = e.features[0].properties
        // MapLibre may return numeric properties as strings; coerce to number
        const idx = props.idx != null ? Number(props.idx) : null

        if (idx !== hoveredIdxRef.current) {
          // Tooltip first — must not be blocked by any setFeatureState error
          const html = `<span style="font-size:12px;font-weight:600">${props.label ?? props.id}</span>`
          if (tooltipRef.current) {
            tooltipRef.current.setLngLat(e.lngLat).setHTML(html)
          } else {
            const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map)
            popup.getElement()?.style.setProperty('pointer-events', 'none')
            tooltipRef.current = popup
          }
          // Hover highlight — clear previous, set new
          if (hoveredIdxRef.current !== null) {
            map.setFeatureState({ source: 'zones', id: hoveredIdxRef.current }, { hovered: false })
          }
          hoveredIdxRef.current = idx
          if (idx !== null) {
            map.setFeatureState({ source: 'zones', id: idx }, { hovered: true })
          }
        } else {
          tooltipRef.current?.setLngLat(e.lngLat)
        }
      })
      map.on('mouseleave', 'zones-fill', () => {
        map.getCanvas().style.cursor = ''
        tooltipRef.current?.remove()
        tooltipRef.current = null
        if (hoveredIdxRef.current !== null) {
          map.setFeatureState({ source: 'zones', id: hoveredIdxRef.current }, { hovered: false })
        }
        hoveredIdxRef.current = null
      })

      // Flow hover tooltips
      for (const tag of ['outgoing', 'incoming', 'internal'] as const) {
        map.on('mousemove', `flows-${tag}-line`, (e) => {
          if (!e.features?.length) return
          map.getCanvas().style.cursor = 'crosshair'
          const p = e.features[0].properties
          const html = `<span dir="rtl" style="font-size:12px;display:block"><b>${p.orig_label}</b> ← <b>${p.dest_label}</b><br/>${Math.round(p.trips).toLocaleString()} נסיעות</span>`
          if (tooltipRef.current) {
            tooltipRef.current.setLngLat(e.lngLat).setHTML(html)
          } else {
            const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map)
            popup.getElement()?.style.setProperty('pointer-events', 'none')
            tooltipRef.current = popup
          }
        })
        map.on('mouseleave', `flows-${tag}-line`, () => {
          map.getCanvas().style.cursor = ''
          tooltipRef.current?.remove()
          tooltipRef.current = null
        })
      }

      // Signal React that the map is ready — this re-triggers all data effects
      setMapReady(true)
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load zone geometry (runs only when zone data changes, not on selection) ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !zonesData) return

    const features = zonesData.features.map((f, i) => ({
      ...f,
      id: i,
      geometry: f.geometry as GeoJSON.Geometry,
      properties: { ...f.properties, idx: i },
    }))

    // Store mapping for the selection effect so it doesn't need to re-run setData
    zoneFeaturesRef.current = features.map((f) => ({
      idx: f.properties.idx as number,
      zoneId: String(f.properties.id),
    }))

    setSource(map, 'zones', { type: 'FeatureCollection', features })

    // Fit bounds on first load
    if (!initialFitRef.current && features.length > 0) {
      initialFitRef.current = true
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
      for (const f of features) {
        const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
        const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1)
        for (const ring of rings) {
          for (const [lon, lat] of ring) {
            if (lon < minLon) minLon = lon
            if (lon > maxLon) maxLon = lon
            if (lat < minLat) minLat = lat
            if (lat > maxLat) maxLat = lat
          }
        }
      }
      map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, duration: 500 })
    }
  }, [mapReady, zonesData])

  // ── Apply selection highlight (never calls setData — avoids clearing feature states) ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    for (const { idx, zoneId } of zoneFeaturesRef.current) {
      map.setFeatureState(
        { source: 'zones', id: idx },
        { selected: selectedZoneIds.has(zoneId) },
      )
    }
  }, [mapReady, selectedZoneIds])

  // ── Update label minzoom per level ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const minzoom = activeLevel === 'TAZ_1270' ? 10 : activeLevel === 'TAZ_250' ? 8 : 6
    map.setLayerZoomRange('zones-labels', minzoom, 24)
  }, [mapReady, activeLevel])

  // ── Update flow lines ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const hasOffset = od.outgoing.length > 0 && od.incoming.length > 0

    const { features: fo, arrowFeatures: ao } = buildFlowFeatures(od.outgoing, centroidMap.current, hasOffset)
    const { features: fi, arrowFeatures: ai } = buildFlowFeatures(od.incoming, centroidMap.current, hasOffset)
    const { features: fint, arrowFeatures: aint } = buildFlowFeatures(od.internal, centroidMap.current, true)

    setSource(map, 'flows-outgoing',  toGeoJSON(fo))
    setSource(map, 'arrows-outgoing', toGeoJSON(ao))
    setSource(map, 'flows-incoming',  toGeoJSON(fi))
    setSource(map, 'arrows-incoming', toGeoJSON(ai))
    setSource(map, 'flows-internal',  toGeoJSON(fint))
    setSource(map, 'arrows-internal', toGeoJSON(aint))
  }, [mapReady, od])

  // ── Toggle flow line labels ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const visibility = showFlowLabels ? 'visible' : 'none'
    for (const tag of ['outgoing', 'incoming', 'internal'] as const) {
      map.setLayoutProperty(`flows-${tag}-labels`, 'visibility', visibility)
    }
  }, [mapReady, showFlowLabels])

  // ── Update zone labels: only selected zones + OD origins/destinations ────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const relevantIds = new Set<string>(selectedZoneIds)
    for (const row of [...od.outgoing, ...od.incoming, ...od.internal]) {
      relevantIds.add(row.origin_id)
      relevantIds.add(row.dest_id)
    }

    const labelFeatures: GeoJSON.Feature[] = []
    for (const [id, { lat, lon, label }] of centroidMap.current) {
      if (!relevantIds.has(id)) continue
      labelFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { label },
      })
    }
    setSource(map, 'zone-labels', toGeoJSON(labelFeatures))
  }, [mapReady, od, selectedZoneIds])

  // ── Basemap switching ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    ;(map.getSource('basemap-source') as maplibregl.RasterTileSource)
      ?.setTiles(BASEMAP_TILES[activeBasemap])

    const isDark = activeBasemap === 'dark'
    map.setPaintProperty('zones-fill', 'fill-color', [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      isDark ? 'rgba(56,189,248,0.55)' : 'rgba(56,189,248,0.50)',
      ['boolean', ['feature-state', 'hovered'], false],
      isDark ? 'rgba(255,255,255,0.18)' : 'rgba(56,189,248,0.20)',
      isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    ])
    map.setPaintProperty('zones-outline', 'line-color',
      isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)')
    map.setPaintProperty('zones-labels', 'text-color', isDark ? '#ffffff' : '#1a1a2e')
    map.setPaintProperty('zones-labels', 'text-halo-color', isDark ? '#000000' : '#ffffff')
  }, [mapReady, activeBasemap])

  return <div ref={containerRef} className="w-full h-full" />
}
