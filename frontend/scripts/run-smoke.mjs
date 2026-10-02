// 用 esbuild 的 JS API 打包冒烟脚本后执行，不依赖平台二进制软链。
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'node_modules', '.cache')
const outFile = path.join(outDir, 'smoke-project.cjs')
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [path.join(root, 'scripts', 'smoke-project.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  logLevel: 'silent',
  alias: { '@': path.join(root, 'src') },
})

await import(outFile)
