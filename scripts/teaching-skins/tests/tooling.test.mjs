import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkTeachingSkins } from '../lib/checker.mjs'
import { createTeachingSkin } from '../new.mjs'

async function tempSkinRoot() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'question-skin-tools-'))
  return directory
}

function skinSource({ target = 'heading', id = 'studio.heading.sample', className = 'td-skin-studio-heading-sample', printSafe = 'true', support = '' } = {}) {
  const helper = target === 'heading' ? 'defineHeadingSkin' : 'defineBoxSkin'
  return `import './styles.css'\nimport { ${helper} } from '@/utils/teachingDocument/skins/authoring'\nexport default ${helper}({ id: '${id}', label: 'Sample', version: 1, printSafe: ${printSafe}, className: '${className}'${support} })\n`
}

async function writeSkin(root, name, options = {}, css = null) {
  const directory = path.join(root, 'custom', name)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'skin.ts'), skinSource(options))
  await fs.writeFile(path.join(directory, 'styles.css'), css ?? `.${options.className || 'td-skin-studio-heading-sample'} { color: inherit; }\n`)
  return directory
}

test('skin:new creates heading and box scaffolds without overwriting', async () => {
  const root = await tempSkinRoot()
  const heading = await createTeachingSkin(['--target', 'heading', '--id', 'studio.heading.lesson-title', '--label', '章节标题', '--levels', '1,2', '--preset', 'left-accent'], root)
  const box = await createTeachingSkin(['--target', 'box', '--id', 'studio.box.notebook', '--label', '笔记卡片', '--templates', 'concept,summary', '--preset', 'header-band'], root)
  assert.equal(heading.target, 'heading')
  assert.equal(box.target, 'box')
  assert.match(await fs.readFile(heading.files[0], 'utf8'), /skins\/authoring/)
  assert.match(await fs.readFile(heading.files[0], 'utf8'), /td-skin-studio-heading-lesson-title/)
  assert.match(await fs.readFile(path.join(heading.directory, 'skin.test.ts'), 'utf8'), /describeTeachingSkinContract/)
  await assert.rejects(() => createTeachingSkin(['--target', 'heading', '--id', 'studio.heading.lesson-title', '--label', '重复'], root), /already exists/)
  assert.equal(await fs.readFile(heading.files[0], 'utf8').then((value) => value.includes('章节标题')), true)
})

test('skin:new rejects invalid arguments and supports dry-run JSON-shaped output', async () => {
  const root = await tempSkinRoot()
  await assert.rejects(() => createTeachingSkin(['--target', 'heading', '--id', 'bad', '--label', 'Bad'], root), /namespaced/)
  await assert.rejects(() => createTeachingSkin(['--target', 'other', '--id', 'studio.heading.other', '--label', 'Bad'], root), /Target/)
  await assert.rejects(() => createTeachingSkin(['--target', 'heading', '--id', 'studio.heading.bad', '--label', 'Bad', '--levels', '1,9'], root), /Heading levels/)
  const dryRun = await createTeachingSkin(['--target', 'heading', '--id', 'studio.heading.dry-run', '--label', 'Dry', '--dry-run', '--json'], root)
  assert.deepEqual(Object.keys(dryRun).sort(), ['className', 'directory', 'dryRun', 'files', 'id', 'ok', 'target'])
  await assert.rejects(() => fs.stat(dryRun.directory), /ENOENT/)
})

test('skin:new rejects duplicate IDs and class names from existing skins', async () => {
  const root = await tempSkinRoot()
  await writeSkin(root, 'existing', { id: 'studio.heading.existing', className: 'td-skin-studio-heading-existing' })
  await assert.rejects(() => createTeachingSkin(['--target', 'heading', '--id', 'studio.heading.existing', '--label', 'Existing'], root), /ID already exists/)
  await writeSkin(root, 'class-taken', { id: 'studio.heading.class-taken', className: 'td-skin-studio-heading-new' })
  await assert.rejects(() => createTeachingSkin(['--target', 'heading', '--id', 'studio.heading.new', '--label', 'New'], root), /className already exists/)
})

test('skin:check accepts valid heading and box skins', async () => {
  const root = await tempSkinRoot()
  await writeSkin(root, 'heading', { id: 'studio.heading.valid', className: 'td-skin-studio-heading-valid', support: ', supportedLevels: [1, 2]' })
  await writeSkin(root, 'box', { target: 'box', id: 'studio.box.valid', className: 'td-skin-studio-box-valid', support: ", supportedTemplates: ['concept']" })
  const result = await checkTeachingSkins({ root })
  assert.equal(result.ok, true)
  assert.equal(result.skins.length, 2)
})

test('skin:check allows the declarative authoring import, sibling CSS, and safe type-only imports', async () => {
  const root = await tempSkinRoot()
  const directory = await writeSkin(root, 'safe-imports', { className: 'td-skin-studio-heading-safe-imports' })
  await fs.writeFile(path.join(directory, 'skin.ts'), "import './styles.css'\nimport type { HeadingSkinDefinition } from '@/utils/teachingDocument/skins/authoring'\nimport { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'\nexport default defineHeadingSkin({ id: 'studio.heading.safe-imports', label: 'Safe', version: 1, printSafe: true, className: 'td-skin-studio-heading-safe-imports' })\n")
  const result = await checkTeachingSkins({ root })
  assert.equal(result.ok, true)
})

for (const [name, setup, expectedCode] of [
  ['duplicate ID', async (root) => { await writeSkin(root, 'one'); await writeSkin(root, 'two', { id: 'studio.heading.sample', className: 'td-skin-two' }) }, 'duplicate-id'],
  ['duplicate className', async (root) => { await writeSkin(root, 'one'); await writeSkin(root, 'two', { id: 'studio.heading.two', className: 'td-skin-studio-heading-sample' }) }, 'duplicate-class-name'],
  ['printSafe false', async (root) => { await writeSkin(root, 'bad', { printSafe: 'false' }) }, 'definition'],
  ['wrong authoring import', async (root) => { const directory = await writeSkin(root, 'bad'); await fs.writeFile(path.join(directory, 'skin.ts'), "import { defineHeadingSkin } from '@/utils/teachingDocument/skins/types'\nexport default defineHeadingSkin({ id: 'studio.heading.bad', label: 'Bad', version: 1, printSafe: true, className: 'td-skin-bad' })\n") }, 'authoring-import'],
  ['local side-effect helper', async (root) => { const directory = await writeSkin(root, 'bad'); await fs.writeFile(path.join(directory, 'skin.ts'), "import './styles.css'\nimport './helper'\nimport { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'\nexport default defineHeadingSkin({ id: 'studio.heading.bad', label: 'Bad', version: 1, printSafe: true, className: 'td-skin-bad' })\n") }, 'local-code-import'],
  ['local TypeScript helper', async (root) => { const directory = await writeSkin(root, 'bad'); await fs.writeFile(path.join(directory, 'skin.ts'), "import './helper.ts'\nimport { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'\nexport default defineHeadingSkin({ id: 'studio.heading.bad', label: 'Bad', version: 1, printSafe: true, className: 'td-skin-bad' })\n") }, 'local-code-import'],
  ['local JavaScript helper', async (root) => { const directory = await writeSkin(root, 'bad'); await fs.writeFile(path.join(directory, 'skin.ts'), "import './helper.js'\nimport { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'\nexport default defineHeadingSkin({ id: 'studio.heading.bad', label: 'Bad', version: 1, printSafe: true, className: 'td-skin-bad' })\n") }, 'local-code-import'],
  ['local named helper import', async (root) => { const directory = await writeSkin(root, 'bad'); await fs.writeFile(path.join(directory, 'skin.ts'), "import { helper } from './helper'\nimport { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'\nexport default defineHeadingSkin({ id: 'studio.heading.bad', label: 'Bad', version: 1, printSafe: true, className: 'td-skin-bad' })\n") }, 'local-code-import'],
  ['global selector', async (root) => { await writeSkin(root, 'bad', {}, 'body { color: red; }') }, 'unscoped-selector'],
  ['fixed positioning', async (root) => { await writeSkin(root, 'bad', {}, '.td-skin-studio-heading-sample { position: fixed; }') }, 'position'],
  ['sticky positioning', async (root) => { await writeSkin(root, 'bad', {}, '.td-skin-studio-heading-sample { position: sticky; }') }, 'position'],
  ['scroll overflow', async (root) => { await writeSkin(root, 'bad', {}, '.td-skin-studio-heading-sample { overflow: scroll; }') }, 'overflow-scroll'],
  ['vertical scroll overflow', async (root) => { await writeSkin(root, 'bad', {}, '.td-skin-studio-heading-sample { overflow-y: scroll; }') }, 'overflow-scroll'],
  ['horizontal auto overflow', async (root) => { await writeSkin(root, 'bad', {}, '.td-skin-studio-heading-sample { overflow-x: auto; }') }, 'overflow-scroll'],
  ['viewport unit', async (root) => { await writeSkin(root, 'bad', {}, '.td-skin-studio-heading-sample { min-height: 30vh; }') }, 'viewport-unit'],
  ['external URL', async (root) => { await writeSkin(root, 'bad', {}, ".td-skin-studio-heading-sample { background-image: url('https://example.com/x.png'); }") }, 'external-url'],
  ['protocol-relative URL', async (root) => { await writeSkin(root, 'bad', {}, ".td-skin-studio-heading-sample { background-image: url('//example.com/x.png'); }") }, 'external-url'],
  ['CSS import', async (root) => { await writeSkin(root, 'bad', {}, "@import '//example.com/style.css';\n.td-skin-studio-heading-sample { color: inherit; }") }, 'css-import'],
  ['page break', async (root) => { await writeSkin(root, 'bad', {}, '.td-skin-studio-heading-sample { break-before: page; }') }, 'pagination-property'],
  ['unscoped selector', async (root) => { await writeSkin(root, 'bad', {}, '.other { color: red; }') }, 'unscoped-selector'],
  ['selector rooted by another class', async (root) => { await writeSkin(root, 'bad', {}, '.other .td-skin-studio-heading-sample { color: red; }') }, 'unscoped-selector'],
  ['negated selector with skin token', async (root) => { await writeSkin(root, 'bad', {}, ':not(.td-skin-studio-heading-sample) .other { color: red; }') }, 'unscoped-selector'],
  ['has selector with skin token', async (root) => { await writeSkin(root, 'bad', {}, '.other:has(.td-skin-studio-heading-sample) { color: red; }') }, 'unscoped-selector'],
  ['skin class prefix match', async (root) => { await writeSkin(root, 'bad', {}, '.td-skin-studio-heading-sample-extra { color: red; }') }, 'unscoped-selector'],
]) {
  test(`skin:check rejects ${name}`, async () => {
    const root = await tempSkinRoot()
    await setup(root)
    const result = await checkTeachingSkins({ root })
    assert.equal(result.ok, false)
    assert.equal(result.errors.some((error) => error.code === expectedCode), true)
  })
}

test('skin:check accepts selectors starting at the exact Skin root', async () => {
  const root = await tempSkinRoot()
  await writeSkin(root, 'rooted', {}, '.td-skin-studio-heading-sample {}\n.td-skin-studio-heading-sample:hover {}\n.td-skin-studio-heading-sample::before {}\n.td-skin-studio-heading-sample .td-box-header {}\n')
  const result = await checkTeachingSkins({ root })
  assert.equal(result.ok, true)
})

test('skin:check reports warnings without failing', async () => {
  const root = await tempSkinRoot()
  await writeSkin(root, 'warning', {}, '.td-skin-studio-heading-sample { position: absolute; }')
  const result = await checkTeachingSkins({ root })
  assert.equal(result.ok, true)
  assert.equal(result.warnings.some((warning) => warning.code === 'absolute-position'), true)
})
