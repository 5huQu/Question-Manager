import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { pythonRoot } from '../config.js'
import { parseJson } from './json.js'
import { pythonCommand, pythonEnv } from '../services/settings/python.js'

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

function extractPdfTextSample(pdfPath: string) {
  if (!fs.existsSync(pdfPath) || path.extname(pdfPath).toLowerCase() !== '.pdf') return ''
  try {
    return execFileSync(pythonCommand(), ['-c', [
      'import sys, fitz',
      'p=sys.argv[1]',
      'doc=fitz.open(p)',
      'parts=[]',
      'limit=min(len(doc), 3)',
      'for i in range(limit): parts.append(doc[i].get_text("text")[:2500])',
      'print("\\n".join(parts)[:6000])',
    ].join('\n'), pdfPath], { env: pythonEnv(), encoding: 'utf8', timeout: 8000, maxBuffer: 1024 * 1024 }).trim()
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Document classification
// ---------------------------------------------------------------------------

type MaterialType = 'exam' | 'lecture' | 'unknown'
type FileRole = 'full' | 'questions' | 'solutions' | 'unknown'

function normalizeUploadName(originalName: string) {
  const decoded = Buffer.from(originalName, 'latin1').toString('utf8')
  return /[À-ÿ]/.test(originalName) && /[一-鿿]/.test(decoded) ? decoded : originalName
}

function classifyUploadedDocument(input: { fileName: string; textSample?: string }) {
  const fileName = normalizeUploadName(input.fileName)
  const compactName = fileName.replace(/\s+/g, '')
  const text = `${compactName}\n${String(input.textSample || '').replace(/\s+/g, '')}`
  const reasons: string[] = []
  let materialType: MaterialType = 'unknown'
  let fileRole: FileRole = 'unknown'
  let confidence = 0.45

  const hasLecture = /(讲义|专题|题型|例题|变式|即学即练|限时训练|课后训练|课堂|学案|导学案)/.test(text)
  const hasExam = /(试卷|试题|考试|联考|月考|期中|期末|模拟|真题|调研|质量检测|高考)/.test(text)
  const hasQuestionsOnly = /(原卷|学生版|无答案|试题版|试卷版)/.test(text)
  const hasSolutionOnly = /(参考答案|答案解析|答案详解|试题答案|详解答案|^答案|答案$|详解$)/.test(compactName) || (/答案/.test(compactName) && !/解析版|精品解析/.test(compactName))
  const hasFullAnalysis = /(解析版|精品解析|含解析|带解析)/.test(text)

  if (hasLecture) {
    materialType = 'lecture'
    fileRole = 'full'
    confidence = 0.86
    reasons.push('检测到讲义/专题/例题/训练等讲义特征')
  }
  if (hasExam || hasQuestionsOnly || hasSolutionOnly || hasFullAnalysis) {
    materialType = 'exam'
    confidence = Math.max(confidence, 0.78)
    if (hasExam) reasons.push('检测到试卷/考试/真题/模拟等试卷特征')
  }
  if (materialType === 'exam') {
    if (hasQuestionsOnly) {
      fileRole = 'questions'
      confidence = Math.max(confidence, 0.9)
      reasons.push('检测到原卷/学生版/无答案特征')
    } else if (hasSolutionOnly) {
      fileRole = 'solutions'
      confidence = Math.max(confidence, 0.86)
      reasons.push('检测到答案/参考答案/详解特征')
    } else if (hasFullAnalysis) {
      fileRole = 'full'
      confidence = Math.max(confidence, 0.86)
      reasons.push('检测到解析版/含解析特征，按题目+解析一体处理')
    } else {
      fileRole = 'full'
      reasons.push('未检测到原卷或单独解析特征，按完整试卷处理')
    }
  }
  if (materialType === 'unknown') {
    fileRole = 'full'
    reasons.push('未检测到稳定资料类型，按单文件完整资料处理')
  }
  return { materialType, fileRole, confidence, reasons }
}

export { extractPdfTextSample, classifyUploadedDocument }
