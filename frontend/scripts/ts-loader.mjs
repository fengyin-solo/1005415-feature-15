// 仅供本地逻辑验证：解析 @ 别名与无扩展名 .ts，并用 TypeScript 自带转译器加载。
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return { url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true }
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context)
    } catch {
      for (const ext of ['.ts', '/index.ts', '.mjs']) {
        const url = new URL(specifier + ext, context.parentURL).href
        if (existsSync(fileURLToPath(url))) {
          return { url, shortCircuit: true }
        }
      }
      throw new Error(`无法解析 ${specifier}（来自 ${context.parentURL}）`)
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
