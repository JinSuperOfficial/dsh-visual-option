#!/usr/bin/env node
/* Turn recorded frames + timestamps into a constant-frame-rate MP4. */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const meta = JSON.parse(readFileSync(join(here, 'out/frames.json'), 'utf8'))
const frames = meta.frames
if (frames.length < 2) throw new Error('not enough frames: ' + frames.length)

const lines = ['ffconcat version 1.0']
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1]
  const duration = next ? Math.max(1 / 60, (next.t - frames[i].t) / 1000) : 0.1
  lines.push(`file 'frames/${frames[i].file}'`)
  lines.push(`duration ${duration.toFixed(4)}`)
}
lines.push(`file 'frames/${frames[frames.length - 1].file}'`)
writeFileSync(join(here, 'out/list.txt'), lines.join('\n') + '\n')

const out = join(here, 'out/acceptance.mp4')
const args = [
  '-y',
  '-f', 'concat',
  '-safe', '0',
  '-i', join(here, 'out/list.txt'),
  '-vf', 'fps=30,format=yuv420p',
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709',
  '-color_primaries', 'bt709',
  '-color_trc', 'bt709',
  '-color_range', 'tv',
  '-movflags', '+faststart',
  out,
]
console.log('ffmpeg', args.join(' '))
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' })
if (r.status !== 0) process.exit(r.status || 1)

const probe = spawnSync('ffprobe', [
  '-v', 'error',
  '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,r_frame_rate,duration,bit_rate',
  '-show_entries', 'format=duration,size',
  '-of', 'default=noprint_wrappers=1',
  out,
], { encoding: 'utf8' })
console.log(probe.stdout)
console.log('wrote', out)
