import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkTeachingSkins, formatCheckResult } from './lib/checker.mjs'

export const DEFAULT_SKIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/src/extensions/teaching-document/skins')

function parseArgs(args) {
  const options = { json: false, pathOption: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json') options.json = true
    else if (arg === '--path') {
      options.pathOption = args[++index]
      if (!options.pathOption) throw new Error('--path requires a skin directory or skin.ts file.')
    }
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

export async function runSkinCheck(args = process.argv.slice(2), root = DEFAULT_SKIN_ROOT) {
  const options = parseArgs(args)
  return { options, result: await checkTeachingSkins({ root, pathOption: options.pathOption }) }
}

async function main() {
  let options = { json: false }
  try {
    const run = await runSkinCheck()
    options = run.options
    if (options.json) process.stdout.write(`${JSON.stringify(run.result, null, 2)}\n`)
    else process.stdout.write(`${formatCheckResult(run.result, DEFAULT_SKIN_ROOT)}\n`)
    process.exitCode = run.result.ok ? 0 : 1
  } catch (error) {
    const result = { ok: false, errors: [{ code: 'usage', message: error instanceof Error ? error.message : String(error) }], warnings: [], skins: [] }
    if (options.json || process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stderr.write(`Teaching Skin Check\n\nERROR: ${result.errors[0].message}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
