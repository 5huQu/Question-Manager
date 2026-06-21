import type { Express } from 'express'
import { upload } from '../../config.js'
import { handlePdfSlicerUploads } from '../../services/pdf-slicer/uploads.js'
import { classifyUploadedDocument, extractPdfTextSample } from '../../utils/pdf-text.js'
import { updateBatchWorkflow } from '../../db/runs.js'
import { isWordUploadKind } from '../../utils/ids.js'

export function mountUploadRoutes(app: Express) {
  app.post('/api/tools/pdf-slicer/uploads', upload.array('files'), (req, res) => {
    try {
      const result = handlePdfSlicerUploads(
        (req.files as Express.Multer.File[]) || [],
        req.body as Record<string, any>,
        {
          isWordUploadKind,
          classifyUploadedDocument: ({ fileName, textSample }) => classifyUploadedDocument({ fileName, textSample }),
          extractPdfTextSample,
          updateBatchWorkflow,
        }
      )
      res.json(result)
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })
}
