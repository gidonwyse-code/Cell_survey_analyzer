import type maplibregl from 'maplibre-gl'

export function addArrowImage(map: maplibregl.Map) {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  // Triangle pointing up (north), rotated by icon-rotate in the layer
  ctx.beginPath()
  ctx.moveTo(size / 2, 1)
  ctx.lineTo(size - 2, size - 2)
  ctx.lineTo(2, size - 2)
  ctx.closePath()
  ctx.fill()
  const imageData = ctx.getImageData(0, 0, size, size)
  map.addImage('arrow', { width: size, height: size, data: imageData.data as unknown as Uint8Array })
}
