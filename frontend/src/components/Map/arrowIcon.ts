import type maplibregl from 'maplibre-gl'

const ARROW_COLORS: Record<string, string> = {
  outgoing: '#DC2626',
  incoming: '#059669',
  internal: 'rgba(255,255,255,0.9)',
}

function createArrow(map: maplibregl.Map, name: string, color: string) {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(size / 2, 1)
  ctx.lineTo(size - 2, size - 2)
  ctx.lineTo(2, size - 2)
  ctx.closePath()
  ctx.fill()
  const imageData = ctx.getImageData(0, 0, size, size)
  map.addImage(name, { width: size, height: size, data: imageData.data as unknown as Uint8Array })
}

export function addArrowImages(map: maplibregl.Map) {
  for (const [tag, color] of Object.entries(ARROW_COLORS)) {
    createArrow(map, `arrow-${tag}`, color)
  }
}
