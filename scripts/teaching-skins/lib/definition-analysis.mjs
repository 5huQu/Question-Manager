import fs from 'node:fs/promises'
import ts from 'typescript'
import { AUTHORING_IMPORT } from './contracts.mjs'

function propertyName(property) {
  if (!property.name) return null
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
    ? property.name.text
    : null
}

function literalValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map((element) => literalValue(element))
    return values.some((value) => value === undefined) ? undefined : values
  }
  return undefined
}

function objectLiteralValue(node) {
  if (!ts.isObjectLiteralExpression(node)) return undefined
  const value = {}
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined
    const name = propertyName(property)
    const item = literalValue(property.initializer)
    if (!name || item === undefined) return undefined
    value[name] = item
  }
  return value
}

export async function analyzeSkinDefinition(file) {
  const source = await fs.readFile(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const errors = sourceFile.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  const imports = sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => ({
      module: ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '',
      typeOnly: Boolean(statement.importClause?.isTypeOnly),
      named: statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
        ? statement.importClause.namedBindings.elements.map((element) => element.name.text)
        : [],
    }))
  const assignment = sourceFile.statements.find(ts.isExportAssignment)
  if (!assignment || assignment.isExportEquals || !ts.isCallExpression(assignment.expression)) {
    errors.push('skin.ts must default-export defineHeadingSkin({...}) or defineBoxSkin({...}).')
    return { file, imports, errors, definition: null }
  }
  const call = assignment.expression
  const helper = ts.isIdentifier(call.expression) ? call.expression.text : ''
  const target = helper === 'defineHeadingSkin' ? 'heading' : helper === 'defineBoxSkin' ? 'box' : null
  if (!target || call.arguments.length !== 1) {
    errors.push('Default export must call defineHeadingSkin({...}) or defineBoxSkin({...}).')
    return { file, imports, errors, definition: null }
  }
  const options = objectLiteralValue(call.arguments[0])
  if (!options) {
    errors.push('Skin definition options must be a static object literal with static values.')
    return { file, imports, errors, definition: null }
  }
  return {
    file,
    imports,
    errors,
    definition: { apiVersion: 1, target, ...options },
    helper,
    usesPublicAuthoringApi: imports.some((entry) => entry.module === AUTHORING_IMPORT && entry.named.includes(helper)),
  }
}
