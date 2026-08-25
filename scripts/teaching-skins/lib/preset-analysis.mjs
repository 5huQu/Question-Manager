import fs from 'node:fs/promises'
import ts from 'typescript'
import { AUTHORING_IMPORT } from './contracts.mjs'

function propertyName(property) {
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined
}
function literalValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isObjectLiteralExpression(node)) {
    const value = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined
      const name = propertyName(property); const item = literalValue(property.initializer)
      if (!name || item === undefined) return undefined
      value[name] = item
    }
    return value
  }
  return undefined
}
export async function analyzePresetDefinition(file) {
  const source = await fs.readFile(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const errors = sourceFile.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  const imports = sourceFile.statements.filter(ts.isImportDeclaration).map((statement) => ({
    module: ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '',
    typeOnly: Boolean(statement.importClause?.isTypeOnly),
    named: statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements.map((element) => element.name.text) : [],
  }))
  const assignment = sourceFile.statements.find(ts.isExportAssignment)
  if (!assignment || assignment.isExportEquals || !ts.isCallExpression(assignment.expression) || !ts.isIdentifier(assignment.expression.expression) || assignment.expression.expression.text !== 'defineTeachingSkinPreset' || assignment.expression.arguments.length !== 1) {
    errors.push('preset.ts must default-export defineTeachingSkinPreset({...}).')
    return { file, imports, errors, definition: null }
  }
  const definition = literalValue(assignment.expression.arguments[0])
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    errors.push('Preset definition options must be a static object literal with static values.')
    return { file, imports, errors, definition: null }
  }
  return { file, imports, errors, definition: { apiVersion: 1, ...definition }, usesPublicAuthoringApi: imports.some((entry) => entry.module === AUTHORING_IMPORT && entry.named.includes('defineTeachingSkinPreset')) }
}
