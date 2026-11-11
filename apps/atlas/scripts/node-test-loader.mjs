import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensions = ['.ts', '.tsx', '.js', '.mjs']
const appUrl = pathToFileURL(appRoot + path.sep).href

async function findModule(base) {
  for (const extension of extensions) {
    const candidate = `${base}${extension}`
    try {
      await access(candidate)
      return pathToFileURL(candidate).href
    } catch {}
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = await findModule(path.join(appRoot, specifier.slice(2)))
    if (resolved) return { url: resolved, shortCircuit: true }
  }

  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(appUrl)) {
      const parentPath = path.dirname(fileURLToPath(context.parentURL))
      const resolved = await findModule(path.resolve(parentPath, specifier))
      if (resolved) return { url: resolved, shortCircuit: true }
    }
    throw error
  }
}
