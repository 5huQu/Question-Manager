import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { dvisvgmPath, xelatexPath } from '../settings/tools.js'
import { RouteError } from '../../utils/http-error.js'
import { sanitizeSvg } from './svg-sanitizer.js'

const run = promisify(execFile)
const TEMPLATE_VERSION = 'tikz-svg-v3'
const MAX_SOURCE = 50_000
const FORBIDDEN = /\\(?:documentclass|usepackage|input|include|openin|openout|write18|write|read|catcode|csname|every|loop|repeat|directlua)\b/i
const template = (source: string) => `\\PassOptionsToPackage{dvipsnames,svgnames}{xcolor}
\\documentclass[tikz,border=2pt]{standalone}
\\usepackage{amsmath,amssymb}
\\usetikzlibrary{arrows.meta,calc,intersections,patterns,positioning}
\\begin{document}
${source}
\\end{document}
`

export function normalizeTikzSource(source: unknown) {
  const normalized = String(source || '').replace(/\r\n?/g, '\n').trim()
  if (!normalized || normalized.length > MAX_SOURCE) throw new RouteError(400, 'TikZ 源码不能为空且不能超过 50000 个字符。')
  if (FORBIDDEN.test(normalized)) throw new RouteError(400, 'TikZ 源码包含不允许的文档、文件或执行命令。')
  if (/\\begin\s*\{document\}|\\end\s*\{document\}/i.test(normalized)) throw new RouteError(400, 'TikZ 源码不能包含完整 LaTeX 文档。')
  return /\\begin\s*\{tikzpicture\}/i.test(normalized) ? normalized : `\\begin{tikzpicture}\n${normalized}\n\\end{tikzpicture}`
}

export async function compileTikz(source: unknown) {
  const normalized = normalizeTikzSource(source)
  const xelatex = xelatexPath(); const dvisvgm = dvisvgmPath()
  if (!xelatex) throw new RouteError(503, '未检测到 XeLaTeX，仍可编辑源码或上传 SVG。', undefined, { error: 'tikz_xelatex_unavailable' })
  if (!dvisvgm) throw new RouteError(503, '未检测到 dvisvgm，无法生成 SVG 预览。', undefined, { error: 'tikz_dvisvgm_unavailable' })
  const sourceHash = `sha256:${createHash('sha256').update(`${TEMPLATE_VERSION}\0${normalized}`).digest('hex')}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'question-tikz-'))
  try {
    const tex = path.join(dir, 'figure.tex'); fs.writeFileSync(tex, template(normalized), 'utf8')
    await run(xelatex, ['-no-shell-escape', '-halt-on-error', '-interaction=nonstopmode', '-output-directory', dir, tex], { cwd: dir, timeout: 20_000, maxBuffer: 128 * 1024, env: { PATH: process.env.PATH || '', TEXMFOUTPUT: dir, openin_any: 'p', openout_any: 'p' } })
    const pdf = path.join(dir, 'figure.pdf'); if (!fs.existsSync(pdf)) throw new Error('PDF output missing')
    try {
      await run(dvisvgm, ['--pdf', '--page=1', '--bbox=min', '--no-fonts', '--output=figure.svg', 'figure.pdf'], { cwd: dir, timeout: 15_000, maxBuffer: 128 * 1024, env: { PATH: process.env.PATH || '' } })
    } catch {
      // Some platform builds of dvisvgm lack a working PDF backend. Keep the
      // same local, single-page pipeline with the bundled OS PDF converter.
      await run('pdftocairo', ['-svg', '-f', '1', '-l', '1', 'figure.pdf', 'figure.svg'], { cwd: dir, timeout: 15_000, maxBuffer: 128 * 1024, env: { PATH: process.env.PATH || '' } })
    }
    const svg = path.join(dir, 'figure.svg'); if (!fs.existsSync(svg)) throw new Error('SVG output missing')
    return { ...sanitizeSvg(fs.readFileSync(svg)), sourceHash }
  } catch (error) {
    const processError = error as { stdout?: string; stderr?: string; message?: string }
    const output = processError.stderr || processError.stdout || processError.message || ''
    const message = String(output).replace(/\/[\w./-]+/g, '').split('\n').filter(Boolean).slice(-4).join(' ')
    throw new RouteError(422, `TikZ 编译失败：${message.slice(0, 300) || '请检查语法。'}`, undefined, { error: 'tikz_compile_failed' })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
