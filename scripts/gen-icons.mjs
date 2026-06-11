// One-off PWA icon generator. Rasterises the SVGs in public/ into the PNGs the
// manifest references. Requires `sharp` (a devDependency installed only when
// regenerating icons): `npm i -D sharp && node scripts/gen-icons.mjs`.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const jobs = [
  { src: 'icon.svg', out: 'pwa-192x192.png', size: 192 },
  { src: 'icon.svg', out: 'pwa-512x512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'maskable-512x512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'apple-touch-icon-180.png', size: 180 },
]

for (const j of jobs) {
  await sharp(join(pub, j.src))
    .resize(j.size, j.size)
    .png()
    .toFile(join(pub, j.out))
  console.log('wrote', j.out, `(${j.size}x${j.size})`)
}
console.log('done')
