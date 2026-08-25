import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkTeachingSkins } from '../lib/checker.mjs'
import { analyzeSkinDefinition } from '../lib/definition-analysis.mjs'

async function tempSkinRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'question-skin-design-metadata-'))
}

function skinSource({ id = 'studio.heading.sample', className = 'td-skin-studio-heading-sample', target = 'heading', design = '' } = {}) {
  const helper = target === 'heading' ? 'defineHeadingSkin' : 'defineBoxSkin'
  return `import './styles.css'\nimport { ${helper} } from '@/utils/teachingDocument/skins/authoring'\nexport default ${helper}({ id: '${id}', label: 'Sample', version: 1, printSafe: true, className: '${className}'${design ? `, design: ${design}` : ''} })\n`
}

async function writeSkin(root, name, options = {}) {
  const directory = path.join(root, 'custom', name)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'skin.ts'), skinSource(options))
  await fs.writeFile(path.join(directory, 'styles.css'), `.${options.className || 'td-skin-studio-heading-sample'} { color: inherit; }\n`)
  return path.join(directory, 'skin.ts')
}

const tokenSet = `{
  tokens: [
    { id: 'studio.color.blue-600', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } },
    { id: 'studio.color.green-600', kind: 'color', label: 'Green', printSafe: true, value: { hex: '#16A34A' } },
    { id: 'studio.spacing.2', kind: 'spacing', label: 'Spacing', printSafe: true, value: { px: 8 } }
  ],
  slots: [
    { id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.blue-600', allowedTokenIds: ['studio.color.blue-600', 'studio.color.green-600'] },
    { id: 'accentSpacing', kind: 'spacing', defaultTokenId: 'studio.spacing.2' }
  ],
  variants: [{ id: 'green', label: 'Green', tokenBindings: { accentColor: 'studio.color.green-600' } }]
}`

test('definition analyzer accepts nested static design metadata', async () => {
  const root = await tempSkinRoot()
  const file = await writeSkin(root, 'nested', { design: tokenSet })
  const analysis = await analyzeSkinDefinition(file)
  assert.deepEqual(analysis.errors, [])
  assert.equal(analysis.definition.design.tokens[0].value.hex, '#2563EB')
  assert.equal(analysis.definition.design.variants[0].tokenBindings.accentColor, 'studio.color.green-600')
})

for (const [name, source] of [
  ['identifier indirection', "const tokens = []\nimport { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'\nexport default defineHeadingSkin({ id: 'studio.heading.bad', label: 'Bad', version: 1, printSafe: true, className: 'td-skin-bad', design: { tokens, slots: [] } })"],
  ['call expression', "import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'\nexport default defineHeadingSkin({ id: 'studio.heading.bad', label: 'Bad', version: 1, printSafe: true, className: 'td-skin-bad', design: buildDesign() })"],
  ['spread expression', "const extra = {}\nimport { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'\nexport default defineHeadingSkin({ id: 'studio.heading.bad', label: 'Bad', version: 1, printSafe: true, className: 'td-skin-bad', design: { ...extra, slots: [] } })"],
]) {
  test(`definition analyzer rejects ${name}`, async () => {
    const root = await tempSkinRoot()
    const file = path.join(root, 'skin.ts')
    await fs.writeFile(file, source)
    const analysis = await analyzeSkinDefinition(file)
    assert.equal(analysis.definition, null)
    assert.equal(analysis.errors.some((error) => /static object literal/.test(error)), true)
  })
}

test('skin:check resolves global Token contributions across skins and permits partial Variant bindings', async () => {
  const root = await tempSkinRoot()
  await writeSkin(root, 'token-owner', {
    id: 'studio.heading.tokens', className: 'td-skin-studio-heading-tokens',
    design: "{ tokens: [{ id: 'studio.color.shared', kind: 'color', label: 'Shared', printSafe: true, value: { hex: '#2563EB' } }], slots: [] }",
  })
  const consumer = await writeSkin(root, 'consumer', {
    id: 'studio.heading.consumer', className: 'td-skin-studio-heading-consumer',
    design: "{ slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.shared' }], variants: [{ id: 'highlight', label: 'Highlight', tokenBindings: { accentColor: 'studio.color.shared' } }] }",
  })
  const result = await checkTeachingSkins({ root })
  assert.equal(result.ok, true)
  const scopedResult = await checkTeachingSkins({ root, pathOption: path.dirname(consumer) })
  assert.equal(scopedResult.ok, true)
})

for (const [name, setup, expectedCode] of [
  ['duplicate global Token ID', async (root) => {
    const design = "{ tokens: [{ id: 'studio.color.shared', kind: 'color', label: 'Shared', printSafe: true, value: { hex: '#2563EB' } }], slots: [] }"
    await writeSkin(root, 'one', { design })
    await writeSkin(root, 'two', { id: 'studio.heading.two', className: 'td-skin-studio-heading-two', design })
  }, 'duplicate-token-id'],
  ['unknown Token', async (root) => writeSkin(root, 'bad', { design: "{ slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.missing' }] }" }), 'design-reference'],
  ['wrong Slot Token kind', async (root) => writeSkin(root, 'bad', { design: "{ tokens: [{ id: 'studio.spacing.2', kind: 'spacing', label: 'Spacing', printSafe: true, value: { px: 8 } }], slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.spacing.2' }] }" }), 'design-reference'],
  ['Variant binds undeclared Slot', async (root) => writeSkin(root, 'bad', { design: "{ tokens: [{ id: 'studio.color.blue', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } }], slots: [], variants: [{ id: 'blue', label: 'Blue', tokenBindings: { accentColor: 'studio.color.blue' } }] }" }), 'design-reference'],
  ['Border references non-color Token', async (root) => writeSkin(root, 'bad', { design: "{ tokens: [{ id: 'studio.spacing.2', kind: 'spacing', label: 'Spacing', printSafe: true, value: { px: 8 } }, { id: 'studio.border.bad', kind: 'border', label: 'Border', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'studio.spacing.2' } }], slots: [] }" }), 'design-reference'],
  ['unsupported metadata key', async (root) => writeSkin(root, 'bad', { design: "{ slots: [], css: 'unsafe' }" }), 'definition'],
  ['defaultVariantId', async (root) => writeSkin(root, 'bad', { design: "{ slots: [], defaultVariantId: 'green' }" }), 'definition'],
]) {
  test(`skin:check rejects ${name}`, async () => {
    const root = await tempSkinRoot()
    await setup(root)
    const result = await checkTeachingSkins({ root })
    assert.equal(result.ok, false)
    assert.equal(result.errors.some((error) => error.code === expectedCode), true)
  })
}

for (const [name, design, expectedCode] of [
  ['duplicate allowed Token', "{ tokens: [{ id: 'studio.color.blue', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } }], slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.blue', allowedTokenIds: ['studio.color.blue', 'studio.color.blue'] }] }", 'definition'],
  ['unknown allowed Token', "{ tokens: [{ id: 'studio.color.blue', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } }], slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.blue', allowedTokenIds: ['studio.color.blue', 'studio.color.missing'] }] }", 'design-reference'],
  ['wrong-kind allowed Token', "{ tokens: [{ id: 'studio.color.blue', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } }, { id: 'studio.spacing.2', kind: 'spacing', label: 'Spacing', printSafe: true, value: { px: 8 } }], slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.blue', allowedTokenIds: ['studio.spacing.2'] }] }", 'design-reference'],
  ['default excluded from allowed Tokens', "{ tokens: [{ id: 'studio.color.blue', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } }, { id: 'studio.color.green', kind: 'color', label: 'Green', printSafe: true, value: { hex: '#16A34A' } }], slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.blue', allowedTokenIds: ['studio.color.green'] }] }", 'design-reference'],
  ['Variant disallowed Token', "{ tokens: [{ id: 'studio.color.blue', kind: 'color', label: 'Blue', printSafe: true, value: { hex: '#2563EB' } }, { id: 'studio.color.green', kind: 'color', label: 'Green', printSafe: true, value: { hex: '#16A34A' } }], slots: [{ id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.blue', allowedTokenIds: ['studio.color.blue'] }], variants: [{ id: 'green', label: 'Green', tokenBindings: { accentColor: 'studio.color.green' } }] }", 'design-reference'],
]) {
  test(`skin:check rejects ${name}`, async () => {
    const root = await tempSkinRoot()
    await writeSkin(root, 'bad', { design })
    const result = await checkTeachingSkins({ root })
    assert.equal(result.ok, false)
    assert.equal(result.errors.some((error) => error.code === expectedCode), true)
  })
}
