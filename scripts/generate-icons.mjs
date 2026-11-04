// Génère les icônes de la PWA (PNG) sans dépendance : `node scripts/generate-icons.mjs`.
// Motif : la flèche de navigation du logo (Navigation2) en blanc sur le bleu de l'appli.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const BLUE = [26, 115, 232] // #1a73e8
const WHITE = [255, 255, 255]
// Flèche Navigation2 (lucide), grille 24×24.
const ARROW = [[12, 2], [19, 21], [12, 17], [5, 21]]
const SUPERSAMPLING = 4

/**
 * @param size taille en pixels
 * @param options.rounded coins arrondis et fond transparent autour (icône « any »)
 * @param options.arrowScale part de l'icône occupée par la flèche
 */
function renderIcon(size, { rounded, arrowScale }) {
  const pixels = Buffer.alloc(size * size * 4)
  const radius = rounded ? size * 0.22 : 0
  const arrowSize = size * arrowScale
  const offset = (size - arrowSize) / 2
  const arrow = ARROW.map(([x, y]) => [offset + (x / 24) * arrowSize, offset + ((y - 0.5) / 24) * arrowSize])

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let background = 0
      let foreground = 0
      for (let sy = 0; sy < SUPERSAMPLING; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLING; sx += 1) {
          const px = x + (sx + 0.5) / SUPERSAMPLING
          const py = y + (sy + 0.5) / SUPERSAMPLING
          if (!insideRoundedSquare(px, py, size, radius)) continue
          background += 1
          if (insidePolygon(px, py, arrow)) foreground += 1
        }
      }
      const samples = SUPERSAMPLING * SUPERSAMPLING
      const alpha = background / samples
      const mix = background > 0 ? foreground / background : 0
      const index = (y * size + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[index + channel] = Math.round(BLUE[channel] * (1 - mix) + WHITE[channel] * mix)
      }
      pixels[index + 3] = Math.round(alpha * 255)
    }
  }
  return encodePng(size, pixels)
}

function insideRoundedSquare(x, y, size, radius) {
  if (radius === 0) return true
  const cx = Math.min(Math.max(x, radius), size - radius)
  const cy = Math.min(Math.max(y, radius), size - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function insidePolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0 // filtre « None »
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // 8 bits par canal
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = 0xffffffff
  for (const byte of typeAndData) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, typeAndData, checksum])
}

mkdirSync('public/icons', { recursive: true })
// Icônes « any » : coins arrondis, fond transparent.
writeFileSync('public/icons/icon-192.png', renderIcon(192, { rounded: true, arrowScale: 0.62 }))
writeFileSync('public/icons/icon-512.png', renderIcon(512, { rounded: true, arrowScale: 0.62 }))
// Icône « maskable » (Android) : fond plein, flèche dans la zone de sécurité centrale.
writeFileSync('public/icons/icon-maskable-512.png', renderIcon(512, { rounded: false, arrowScale: 0.5 }))
// iOS arrondit lui-même les icônes et n'accepte pas la transparence.
writeFileSync('public/icons/apple-touch-icon.png', renderIcon(180, { rounded: false, arrowScale: 0.6 }))
console.log('Icônes générées dans public/icons/')
