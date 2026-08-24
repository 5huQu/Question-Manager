import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classNameForSkinId, skinDirectorySlug, validateNewSkinOptions } from './lib/contracts.mjs'
import { skinFilesIn } from './lib/discovery.mjs'
import { analyzeSkinDefinition } from './lib/definition-analysis.mjs'

export const DEFAULT_SKIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/src/extensions/teaching-document/skins')

export function skinScaffoldFiles(options) {
  const className = classNameForSkinId(options.id)
  const support = options.target === 'heading'
    ? options.levels?.length ? `,\n  supportedLevels: [${options.levels.join(', ')}]` : ''
    : options.templates?.length ? `,\n  supportedTemplates: [${options.templates.map((item) => JSON.stringify(item)).join(', ')}]` : ''
  const helper = options.target === 'heading' ? 'defineHeadingSkin' : 'defineBoxSkin'
  const presetCss = cssForPreset(options.target, options.preset, className)
  const skin = `import './styles.css'\nimport { ${helper} } from '@/utils/teachingDocument/skins/authoring'\n\nexport default ${helper}({\n  id: ${JSON.stringify(options.id)},\n  label: ${JSON.stringify(options.label)},\n  version: 1,\n  printSafe: true,\n  className: ${JSON.stringify(className)}${support},\n})\n`
  const test = `import { describeTeachingSkinContract } from '@/test-utils/teachingSkinContract'\nimport skin from './skin'\n\ndescribeTeachingSkinContract(skin)\n`
  const readme = `# ${options.label}\n\n- ID: \`${options.id}\`\n- Target: \`${options.target}\`\n- Preset: \`${options.preset}\`\n\nEdit only this directory, then run:\n\n\`npm run skin:check -- --path frontend/src/extensions/teaching-document/skins/custom/${skinDirectorySlug(options.id)}\`\n`
  return { className, files: { 'skin.ts': skin, 'styles.css': presetCss, 'skin.test.ts': test, 'README.md': readme } }
}

function cssForPreset(target, preset, className) {
  const scope = `.${className}`
  if (target === 'heading') {
    if (preset === 'left-accent') return `${scope} {\n  border-left: 4px solid #334155;\n  padding-left: 0.65em;\n}\n`
    if (preset === 'pill') return `${scope} {\n  display: inline-block;\n  border: 1px solid #cbd5e1;\n  border-radius: 999px;\n  padding: 0.2em 0.7em;\n  background: #f8fafc;\n}\n`
    return `${scope} {\n  color: inherit;\n}\n`
  }
  if (preset === 'left-accent') return `${scope} {\n  border-left: 4px solid #334155;\n}\n\n${scope} .td-box-header {\n  background: #f8fafc;\n}\n`
  if (preset === 'header-band') return `${scope} {\n  border-color: #334155;\n}\n\n${scope} .td-box-header {\n  background: #334155;\n  color: #fff;\n}\n`
  return `${scope} {\n  border-color: #cbd5e1;\n}\n`
}

function parseArgs(args) {
  const options = { json: false, dryRun: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json') options.json = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (['--target', '--id', '--label', '--levels', '--templates', '--preset'].includes(arg)) options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = args[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

async function existingDefinitions(root) {
  const files = await skinFilesIn(root)
  return Promise.all(files.map(analyzeSkinDefinition))
}

export async function createTeachingSkin(args = process.argv.slice(2), root = DEFAULT_SKIN_ROOT) {
  const rawOptions = parseArgs(args)
  const options = validateNewSkinOptions(rawOptions)
  const slug = skinDirectorySlug(options.id)
  const directory = path.join(root, 'custom', slug)
  const scaffold = skinScaffoldFiles(options)
  const definitions = await existingDefinitions(root)
  if (definitions.some((item) => item.definition?.id === options.id)) throw new Error(`Skin ID already exists: ${options.id}`)
  if (definitions.some((item) => item.definition?.className === scaffold.className)) throw new Error(`Skin className already exists: ${scaffold.className}`)
  if (await fs.stat(directory).catch(() => null)) throw new Error(`Target directory already exists: ${directory}`)
  const files = Object.keys(scaffold.files).map((name) => path.join(directory, name))
  if (!rawOptions.dryRun) {
    await fs.mkdir(path.join(root, 'custom'), { recursive: true })
    await fs.mkdir(directory, { recursive: false })
    await Promise.all(Object.entries(scaffold.files).map(([name, content]) => fs.writeFile(path.join(directory, name), content, 'utf8')))
  }
  return { ok: true, id: options.id, target: options.target, directory, files, dryRun: rawOptions.dryRun, className: scaffold.className }
}

function usage() {
  return `Usage:\n  npm run skin:new -- --target heading --id studio.heading.lesson-title --label "章节标题" --levels 1,2 --preset minimal\n  npm run skin:new -- --target box --id studio.box.notebook --label "笔记卡片" --templates concept,summary --preset minimal\n\nOptions: --target, --id, --label, --levels, --templates, --preset, --dry-run, --json`
}

async function main() {
  const json = process.argv.includes('--json')
  try {
    if (process.argv.length <= 2) throw new Error(usage())
    const result = await createTeachingSkin()
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stdout.write(`Created Teaching Skin\n\nID:\n${result.id}\n\nTarget:\n${result.target}\n\nFiles:\n${result.files.map((file) => `- ${file}`).join('\n')}\n\nNext:\nnpm run skin:check -- --path ${result.directory}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`)
    else process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
