import { closeDatabase } from '../dist/index.js'
import { db } from '../dist/db/connection.js'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const storageRoot = path.resolve(__dirname, '../..')
const sourceDocumentId = 'srcdoc_20260624125827_c952ba_ç²¾å_è_æ_ï¼_å¹_ä_æ_å_³å_2026å_é_ä_å¹_çº_ä_å_æ_ç_äº_æ_è_ç_è_è_æ_å_è_é_ï¼_è_æ_ç_ï¼'

function getUrlPathname(url) {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function getUrlExtension(url) {
  let ext = '.png'
  try {
    const parsedUrl = new URL(url)
    const pathnameExt = path.extname(parsedUrl.pathname).toLowerCase()
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(pathnameExt)) {
      ext = pathnameExt
    }
  } catch (e) {
    // ignore
  }
  return ext
}

try {
  console.log('Starting backfill for source document:', sourceDocumentId)
  
  // 1. Get OCR Document record
  const ocrDocRow = db.prepare("SELECT * FROM ocr_documents WHERE source_document_id = ?").get(sourceDocumentId)
  if (!ocrDocRow) {
    console.error('OCR Document not found in DB for source doc ID:', sourceDocumentId)
    process.exit(1)
  }
  
  console.log(`Found OCR Document ID: ${ocrDocRow.id}`)
  
  // 2. Read assets.json on disk
  const assetsJsonPath = path.join(storageRoot, ocrDocRow.assets_json_path)
  if (!fs.existsSync(assetsJsonPath)) {
    console.error('assets.json does not exist at:', assetsJsonPath)
    process.exit(1)
  }
  
  const assets = JSON.parse(fs.readFileSync(assetsJsonPath, 'utf8'))
  console.log(`Loaded ${assets.length} assets from assets.json`)
  
  // Update assets with local paths
  const assetsMap = new Map() // remotePathname -> asset
  const assetsById = new Map() // assetId -> asset
  
  for (const asset of assets) {
    const remoteUrl = asset.path
    if (remoteUrl && /^https?:\/\//.test(remoteUrl)) {
      const pathname = getUrlPathname(remoteUrl)
      const hash = createHash('sha256').update(remoteUrl).digest('hex').slice(0, 16)
      const ext = getUrlExtension(remoteUrl)
      const filename = `img_${hash}${ext}`
      const localPath = `data/import-flow-v2/source-documents/${sourceDocumentId}/assets/${filename}`
      
      asset.localPath = localPath
      assetsMap.set(pathname, asset)
      assetsById.set(asset.id, asset)
      
      // Also update the asset path to local in the assets list
      asset.path = localPath
    } else {
      asset.localPath = asset.path
      assetsMap.set(asset.path, asset)
      assetsById.set(asset.id, asset)
    }
  }
  
  // Overwrite assets.json
  fs.writeFileSync(assetsJsonPath, JSON.stringify(assets, null, 2), 'utf8')
  console.log('Successfully updated and saved assets.json with localized paths.')
  
  // 3. Update markdown.md on disk
  const markdownPath = path.join(storageRoot, ocrDocRow.markdown_path)
  if (fs.existsSync(markdownPath)) {
    let markdown = fs.readFileSync(markdownPath, 'utf8')
    const originalLen = markdown.length
    
    // Replace URLs with placeholders
    const mdPattern = /!\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/gi
    const htmlPattern = /<img\b[^>]*?\bsrc\s*=\s*(?:(["'])([\s\S]*?)\1|([^\s>]+))[^>]*?>/gi
    
    const matches = []
    for (const match of markdown.matchAll(mdPattern)) {
      const url = (match[1] || match[2] || '').replace(/\\\)/g, ')').trim()
      if (url) matches.push({ matchedText: match[0], url })
    }
    for (const match of markdown.matchAll(htmlPattern)) {
      const url = (match[2] || match[3] || '').trim()
      if (url) matches.push({ matchedText: match[0], url })
    }
    
    for (const item of matches) {
      const pathname = getUrlPathname(item.url)
      const asset = assetsMap.get(pathname)
      if (asset) {
        markdown = markdown.split(item.matchedText).join(`<!-- DOC2X_FIGURE:${asset.id} -->`)
      }
    }
    
    fs.writeFileSync(markdownPath, markdown, 'utf8')
    console.log(`Successfully updated markdown.md (length ${originalLen} -> ${markdown.length})`)
  }
  
  // 4. Update question_candidates and question_bank_items
  const candidates = db.prepare("SELECT * FROM question_candidates WHERE source_document_id = ?").all(sourceDocumentId)
  console.log(`Found ${candidates.length} candidates in DB to update.`)
  
  const updateCandStmt = db.prepare(`
    UPDATE question_candidates
    SET stem_markdown = ?, analysis_markdown = ?, figures_json = ?, updated_at = ?
    WHERE id = ?
  `)
  
  const updateBankStmt = db.prepare(`
    UPDATE question_bank_items
    SET stem_markdown = ?, analysis_markdown = ?, figures_json = ?, updated_at = ?
    WHERE id = ?
  `)
  
  const now = new Date().toISOString()
  let updatedCandidates = 0
  let updatedBankItems = 0
  
  for (const cand of candidates) {
    let stemMarkdown = cand.stem_markdown || ''
    let analysisMarkdown = cand.analysis_markdown || ''
    
    // Replace URLs with placeholders in markdowns
    const mdPattern = /!\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/gi
    const htmlPattern = /<img\b[^>]*?\bsrc\s*=\s*(?:(["'])([\s\S]*?)\1|([^\s>]+))[^>]*?>/gi
    
    const matches = []
    for (const match of stemMarkdown.matchAll(mdPattern)) {
      const url = (match[1] || match[2] || '').replace(/\\\)/g, ')').trim()
      if (url) matches.push({ matchedText: match[0], url })
    }
    for (const match of stemMarkdown.matchAll(htmlPattern)) {
      const url = (match[2] || match[3] || '').trim()
      if (url) matches.push({ matchedText: match[0], url })
    }
    for (const match of analysisMarkdown.matchAll(mdPattern)) {
      const url = (match[1] || match[2] || '').replace(/\\\)/g, ')').trim()
      if (url) matches.push({ matchedText: match[0], url })
    }
    for (const match of analysisMarkdown.matchAll(htmlPattern)) {
      const url = (match[2] || match[3] || '').trim()
      if (url) matches.push({ matchedText: match[0], url })
    }
    
    for (const item of matches) {
      const pathname = getUrlPathname(item.url)
      const asset = assetsMap.get(pathname)
      if (asset) {
        stemMarkdown = stemMarkdown.split(item.matchedText).join(`<!-- DOC2X_FIGURE:${asset.id} -->`)
        analysisMarkdown = analysisMarkdown.split(item.matchedText).join(`<!-- DOC2X_FIGURE:${asset.id} -->`)
      }
    }
    
    // Extract inline ids from final markdowns
    const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/g
    const inlineIds = new Set()
    for (const match of stemMarkdown.matchAll(DOC2X_FIGURE_MARKER_RE)) {
      inlineIds.add(match[1])
    }
    const analysisInlineIds = new Set()
    for (const match of analysisMarkdown.matchAll(DOC2X_FIGURE_MARKER_RE)) {
      analysisInlineIds.add(match[1])
    }
    
    // Rebuild figures_json
    const existingFigures = JSON.parse(cand.figures_json || '[]')
    const updatedFigures = []
    const addedIds = new Set()
    
    // 1. Add all inline figures
    for (const id of inlineIds) {
      const asset = assetsById.get(id)
      if (asset) {
        updatedFigures.push({
          id: asset.id,
          blockId: asset.id,
          usage: 'stem',
          category: 'question',
          path: asset.localPath,
          pageNo: asset.pageNo || 1,
          bbox: asset.bbox,
        })
        addedIds.add(id)
      }
    }
    for (const id of analysisInlineIds) {
      const asset = assetsById.get(id)
      if (asset) {
        updatedFigures.push({
          id: asset.id,
          blockId: asset.id,
          usage: 'analysis',
          category: 'analysis',
          path: asset.localPath,
          pageNo: asset.pageNo || 1,
          bbox: asset.bbox,
        })
        addedIds.add(id)
      }
    }
    
    // 2. Add other figures (non-inline) and localize their path
    for (const fig of existingFigures) {
      const figId = fig.id || fig.blockId
      if (!addedIds.has(figId)) {
        let localPath = fig.path
        if (fig.path && /^https?:\/\//.test(fig.path)) {
          const pathname = getUrlPathname(fig.path)
          const asset = assetsMap.get(pathname)
          if (asset) {
            localPath = asset.localPath
          }
        }
        
        let usage = fig.usage || 'stem'
        if (usage === 'question') usage = 'stem'
        let category = fig.category
        if (usage === 'analysis') {
          category = 'analysis'
        } else {
          category = 'question'
        }
        
        updatedFigures.push({
          ...fig,
          usage,
          category,
          path: localPath,
        })
        addedIds.add(figId)
      }
    }
    
    const figuresJson = JSON.stringify(updatedFigures)
    
    // Update candidate
    updateCandStmt.run(stemMarkdown, analysisMarkdown, figuresJson, now, cand.id)
    updatedCandidates++
    
    // If committed, update the question bank item
    if (cand.status === 'committed' && cand.committed_question_id) {
      updateBankStmt.run(stemMarkdown, analysisMarkdown, figuresJson, now, cand.committed_question_id)
      updatedBankItems++
    }
  }
  
  console.log(`Updated ${updatedCandidates} candidates in question_candidates.`)
  console.log(`Updated ${updatedBankItems} items in question_bank_items.`)
  console.log('Backfill finished successfully!')
  
} catch (err) {
  console.error('Backfill failed:', err)
  process.exit(1)
} finally {
  closeDatabase()
}
