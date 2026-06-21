import type { Express } from 'express'
import { readPdfSlicerRules, writePdfSlicerRules, validatePdfSlicerRules, listPdfSlicerRulesHistory, computeJsonHash, pdfSlicerRulesHistoryDir } from '../../services/pdf-slicer/rules.js'
import type { SlicerRulesData } from '../../types/index.js'
import fs from 'node:fs'
import path from 'node:path'

export function mountRuleRoutes(app: Express) {
  app.get('/api/tools/pdf-slicer/rules', (_, res) => {
    try {
      const rules = readPdfSlicerRules()
      const hash = computeJsonHash(rules)
      res.json({ ...rules, baseVersion: rules.version, hash } as Record<string, unknown>)
    } catch (error) {
      res.status(500).json({ error: '读取切题规则失败' })
    }
  })

  app.put('/api/tools/pdf-slicer/rules', (req, res) => {
    try {
      const { rules: rulesData, baseVersion } = (req.body || {}) as { rules: unknown; baseVersion: unknown }
      if (!rulesData) {
        res.status(400).json({ error: '缺少 rules 字段' })
        return
      }
      const validation = validatePdfSlicerRules(rulesData)
      if (!validation.valid) {
        res.status(400).json({ error: '规则验证失败', details: validation.errors })
        return
      }
      const currentRules = readPdfSlicerRules()
      const expectedVersion = Number(baseVersion ?? currentRules.version)
      if (currentRules.version !== expectedVersion) {
        res.status(409).json({
          error: '规则已被其他操作更新，请刷新后重试',
          currentBaseVersion: currentRules.version,
        })
        return
      }
      const result = writePdfSlicerRules(rulesData as SlicerRulesData, expectedVersion)
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: '保存切题规则失败' })
    }
  })

  app.post('/api/tools/pdf-slicer/rules/validate', (req, res) => {
    try {
      const validation = validatePdfSlicerRules(req.body?.rules)
      res.json(validation)
    } catch (error) {
      res.status(500).json({ error: '验证规则失败' })
    }
  })

  app.get('/api/tools/pdf-slicer/rules/history', (_, res) => {
    try {
      const history = listPdfSlicerRulesHistory()
      res.json({ history })
    } catch (error) {
      res.status(500).json({ error: '读取规则历史失败' })
    }
  })

  app.post('/api/tools/pdf-slicer/rules/rollback/:version', (req, res) => {
    try {
      const targetVersion = Number(req.params.version)
      if (!Number.isFinite(targetVersion)) {
        res.status(400).json({ error: '无效的版本号' })
        return
      }
      const historyDir = pdfSlicerRulesHistoryDir()
      const files = fs.readdirSync(historyDir).filter((f) => f.includes(`v${targetVersion}_`))
      if (!files.length) {
        res.status(404).json({ error: `未找到版本 v${targetVersion} 的快照` })
        return
      }
      files.sort().reverse()
      const snapshot = JSON.parse(fs.readFileSync(path.join(historyDir, files[0]), 'utf8')) as SlicerRulesData
      if (!snapshot.version) {
        res.status(500).json({ error: '快照数据损坏' })
        return
      }
      const currentRules = readPdfSlicerRules()
      const result = writePdfSlicerRules(snapshot, currentRules.version)
      res.json(result)
    } catch (error) {
      res.status(500).json({ error: '回滚规则失败' })
    }
  })
}
