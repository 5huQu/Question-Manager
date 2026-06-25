import { closeDatabase } from '../dist/index.js'
import { db } from '../dist/db/connection.js'

try {
  console.log('Starting DB migration for v2 imported figures...')
  
  // 1. Update question_bank_items
  const items = db.prepare("SELECT id, figures_json FROM question_bank_items WHERE source_run_id LIKE 'ifv2:%'").all()
  console.log(`Found ${items.length} items in question_bank_items to check.`)
  
  let updatedItemsCount = 0
  const updateStmt = db.prepare("UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?")
  const now = new Date().toISOString()
  
  for (const item of items) {
    let figures = []
    try {
      figures = JSON.parse(item.figures_json || '[]')
    } catch {
      continue
    }
    
    let changed = false
    const updatedFigures = figures.map((figure) => {
      let usage = figure.usage || 'stem'
      if (usage === 'question') {
        usage = 'stem'
        changed = true
      }
      
      let category = figure.category
      if (usage === 'analysis') {
        if (category !== 'analysis') {
          category = 'analysis'
          changed = true
        }
      } else {
        if (category !== 'question') {
          category = 'question'
          changed = true
        }
      }
      
      return {
        ...figure,
        usage,
        category,
      }
    })
    
    if (changed) {
      updateStmt.run(JSON.stringify(updatedFigures), now, item.id)
      updatedItemsCount++
    }
  }
  console.log(`Updated ${updatedItemsCount} items in question_bank_items.`)
  
  // 2. Update question_candidates
  const candidates = db.prepare("SELECT id, figures_json FROM question_candidates").all()
  console.log(`Found ${candidates.length} candidates in question_candidates to check.`)
  
  let updatedCandidatesCount = 0
  const updateCandidateStmt = db.prepare("UPDATE question_candidates SET figures_json = ?, updated_at = ? WHERE id = ?")
  
  for (const cand of candidates) {
    let figures = []
    try {
      figures = JSON.parse(cand.figures_json || '[]')
    } catch {
      continue
    }
    
    let changed = false
    const updatedFigures = figures.map((figure) => {
      let usage = figure.usage || 'stem'
      if (usage === 'question') {
        usage = 'stem'
        changed = true
      }
      
      let category = figure.category
      if (usage === 'analysis') {
        if (category !== 'analysis') {
          category = 'analysis'
          changed = true
        }
      } else {
        if (category !== 'question') {
          category = 'question'
          changed = true
        }
      }
      
      return {
        ...figure,
        usage,
        category,
      }
    })
    
    if (changed) {
      updateCandidateStmt.run(JSON.stringify(updatedFigures), now, cand.id)
      updatedCandidatesCount++
    }
  }
  console.log(`Updated ${updatedCandidatesCount} candidates in question_candidates.`)
  
  console.log('Migration finished successfully!')
} catch (err) {
  console.error('Migration failed:', err)
  process.exit(1)
} finally {
  closeDatabase()
}
