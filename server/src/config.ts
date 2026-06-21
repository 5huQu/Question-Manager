import { createRequire } from 'node:module'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const sourceRoot = path.resolve(__dirname, '../..')
export const storageRoot = path.resolve(process.env.QUESTION_DATA_DIR || sourceRoot)
export const dataDir = path.join(storageRoot, 'data')
export const runsRoot = path.join(storageRoot, 'experiments', 'pdf_slicer', 'runs')
export const sqlitePath = path.join(dataDir, 'question.sqlite')
export const tagLibrariesDir = path.join(sourceRoot, 'server', 'tag_libraries')
export const pythonRoot = path.join(sourceRoot, 'server', 'python')
export const pythonDataRoot = path.join(storageRoot, 'python')
export const frontendDist = path.join(sourceRoot, 'frontend', 'dist')
export const upload = multer({ storage: multer.memoryStorage() })
const require = createRequire(import.meta.url)
export const katex = require('katex') as { renderToString: (tex: string, options?: Record<string, unknown>) => string }

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(runsRoot, { recursive: true })
fs.mkdirSync(pythonDataRoot, { recursive: true })
fs.mkdirSync(tagLibrariesDir, { recursive: true })
