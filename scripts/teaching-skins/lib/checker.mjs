import path from 'node:path'
import { analyzeSkinCss } from './css-analysis.mjs'
import { AUTHORING_IMPORT, designMetadataReferenceIssues, presetDefinitionShapeIssues, presetReferenceIssues, skinDefinitionShapeIssues, tokenDefinitionShapeIssues, tokensFromSkinDefinition } from './contracts.mjs'
import { cssFilesForSkin, isCustomSkin, presetFilesIn, relativeTo, resolveSkinPath, skinFilesIn } from './discovery.mjs'
import { analyzeSkinDefinition } from './definition-analysis.mjs'
import { analyzePresetDefinition } from './preset-analysis.mjs'

function checkIssue(code, file, message) {
  return { code, file, message }
}

function importIssues(analysis, custom) {
  if (!custom) return []
  const issues = []
  if (!analysis.usesPublicAuthoringApi) {
    issues.push(checkIssue('authoring-import', analysis.file, `Custom skins must import their helper from ${AUTHORING_IMPORT}.`))
  }
  for (const entry of analysis.imports) {
    if (entry.module === AUTHORING_IMPORT) continue
    if (entry.typeOnly && entry.module.startsWith('@/')) continue
    if (/^\.\/[^/]+\.css$/i.test(entry.module)) continue
    if (/^\.\//.test(entry.module)) {
      issues.push(checkIssue('local-code-import', analysis.file, `Custom skins may import only a sibling CSS file, not local executable code: ${entry.module}`))
      continue
    }
    issues.push(checkIssue('runtime-core-import', analysis.file, `Custom skin import is outside the authoring boundary: ${entry.module}`))
  }
  return issues
}

export async function checkTeachingSkins({ root, pathOption } = {}) {
  const selectedFiles = await resolveSkinPath(root, pathOption)
  const allFiles = await skinFilesIn(root)
  const analyses = await Promise.all(allFiles.map(analyzeSkinDefinition))
  const presetAnalyses = await Promise.all((await presetFilesIn(root)).map(analyzePresetDefinition))
  const errors = []
  const warnings = []
  const ids = new Map()
  const classNames = new Map()
  const tokenIndex = new Map()
  const skinDefinitions = new Map()

  for (const analysis of analyses) {
    if (!analysis.definition) continue
    for (const token of tokensFromSkinDefinition(analysis.definition)) {
      if (!token || typeof token !== 'object' || typeof token.id !== 'string') continue
      const contributions = tokenIndex.get(token.id) || []
      if (contributions.length) {
        const selected = !selectedFiles || selectedFiles.has(analysis.file)
        if (selected || contributions.some((entry) => selectedFiles?.has(entry.file))) {
          errors.push(checkIssue('duplicate-token-id', analysis.file, `Duplicate Token ID ${token.id}; also used by ${relativeTo(root, contributions[0].file)}.`))
        }
      }
      contributions.push({ file: analysis.file, token, shapeIssues: tokenDefinitionShapeIssues(token) })
      tokenIndex.set(token.id, contributions)
    }
  }

  for (const analysis of analyses) {
    const selected = !selectedFiles || selectedFiles.has(analysis.file)
    if (!analysis.definition) {
      if (selected) errors.push(...analysis.errors.map((message) => checkIssue('definition', analysis.file, message)))
      continue
    }
    const { definition } = analysis
    if (!skinDefinitions.has(definition.id)) skinDefinitions.set(definition.id, definition)
    for (const message of skinDefinitionShapeIssues(definition)) {
      if (selected) errors.push(checkIssue('definition', analysis.file, message))
    }
    if (ids.has(definition.id)) {
      const message = `Duplicate skin ID ${definition.id}; also used by ${relativeTo(root, ids.get(definition.id))}.`
      if (selected || selectedFiles?.has(ids.get(definition.id))) errors.push(checkIssue('duplicate-id', analysis.file, message))
    } else ids.set(definition.id, analysis.file)
    if (classNames.has(definition.className)) {
      const message = `Duplicate className ${definition.className}; also used by ${relativeTo(root, classNames.get(definition.className))}.`
      if (selected || selectedFiles?.has(classNames.get(definition.className))) errors.push(checkIssue('duplicate-class-name', analysis.file, message))
    } else classNames.set(definition.className, analysis.file)
    if (!selected) continue
    errors.push(...analysis.errors.map((message) => checkIssue('definition', analysis.file, message)))
    errors.push(...importIssues(analysis, isCustomSkin(root, analysis.file)))
    errors.push(...designMetadataReferenceIssues(definition.design, tokenIndex).map((message) => checkIssue('design-reference', analysis.file, message)))
    const cssFiles = await cssFilesForSkin(analysis.file)
    if (!cssFiles.length) warnings.push(checkIssue('missing-css', analysis.file, 'No sibling CSS file found; verify this intentionally has no visual rules.'))
    for (const cssFile of cssFiles) {
      const cssResult = await analyzeSkinCss(cssFile, definition.className)
      errors.push(...cssResult.errors.map(({ code, file, message }) => checkIssue(code, file, message)))
      warnings.push(...cssResult.warnings.map(({ code, file, message }) => checkIssue(code, file, message)))
    }
  }

  const presetIds = new Map()
  for (const analysis of presetAnalyses) {
    if (!analysis.definition) { errors.push(...analysis.errors.map((message) => checkIssue('preset-definition', analysis.file, message))); continue }
    for (const message of presetDefinitionShapeIssues(analysis.definition)) errors.push(checkIssue('preset-definition', analysis.file, message))
    const key = `${analysis.definition.id}@${analysis.definition.version}`
    if (presetIds.has(key)) errors.push(checkIssue('duplicate-preset', analysis.file, `Duplicate Preset ${key}; also used by ${relativeTo(root, presetIds.get(key))}.`))
    else presetIds.set(key, analysis.file)
    if (!analysis.usesPublicAuthoringApi) errors.push(checkIssue('preset-authoring-import', analysis.file, `Preset must import defineTeachingSkinPreset from ${AUTHORING_IMPORT}.`))
    errors.push(...analysis.errors.map((message) => checkIssue('preset-definition', analysis.file, message)))
    errors.push(...presetReferenceIssues(analysis.definition, skinDefinitions).map((message) => checkIssue('preset-reference', analysis.file, message)))
  }

  const skins = analyses
    .filter((analysis) => analysis.definition && (!selectedFiles || selectedFiles.has(analysis.file)))
    .map((analysis) => ({
      file: relativeTo(root, analysis.file),
      id: analysis.definition.id,
      target: analysis.definition.target,
      version: analysis.definition.version,
      className: analysis.definition.className,
    }))
  return { ok: errors.length === 0, errors, warnings, skins }
}

export function formatCheckResult(result, root) {
  const lines = ['Teaching Skin Check', '']
  for (const skin of result.skins) {
    lines.push(`${skin.id} (${skin.target}, v${skin.version})`)
    lines.push(`  ${skin.file}`)
  }
  if (!result.skins.length) lines.push('No skins selected.')
  for (const error of result.errors) lines.push(`  ERROR [${error.code}] ${path.relative(root, error.file)} — ${error.message}`)
  for (const warning of result.warnings) lines.push(`  WARN  [${warning.code}] ${path.relative(root, warning.file)} — ${warning.message}`)
  lines.push('', `Result: ${result.ok ? 'PASS' : 'FAIL'}`, `Warnings: ${result.warnings.length}`, `Errors: ${result.errors.length}`)
  return lines.join('\n')
}
