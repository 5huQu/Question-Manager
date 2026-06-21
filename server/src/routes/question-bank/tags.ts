import fs from 'node:fs'
import type { Express } from 'express'
import { readTagLibraries, readLearningTagLibraries, writeLearningTagLibrary, safeTagLibraryCode, tagLibraryFilePath } from '../../services/tags/tag-libraries.js'

export function mountTagRoutes(app: Express) {
  app.get('/api/question-bank/tag-libraries', (_, res) => {
    res.json(readTagLibraries())
  })

  app.get('/api/learning-tags/libraries', (_, res) => {
    res.json({ libraries: readLearningTagLibraries() })
  })

  app.post('/api/learning-tags/libraries', (req, res) => {
    try {
      const library = writeLearningTagLibrary(req.body)
      res.json({ library })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.delete('/api/learning-tags/libraries/:id', (req, res) => {
    const id = safeTagLibraryCode(decodeURIComponent(req.params.id))
    const libraries = readLearningTagLibraries()
    const library = libraries.find((item) => item.id === id || item.code === id)
    if (!library) {
      res.status(404).json({ error: '标签库不存在。' })
      return
    }
    if (library.isDefault) {
      res.status(400).json({ error: '默认标签库不可删除，请先将其他知识点标签库设为默认。' })
      return
    }
    if (libraries.length <= 1) {
      res.status(400).json({ error: '至少需要保留一个标签库。' })
      return
    }
    const filePath = tagLibraryFilePath(library.code)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    res.json({ ok: true })
  })
}
