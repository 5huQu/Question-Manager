import type { CandidateFixRegionInput } from '../../types/candidate-fix.js'
import { RouteError } from '../../utils/http-error.js'

export function validateCandidateFixRegions(
  regions: unknown,
  pageCountBySourceDocument: Map<string, number>,
): CandidateFixRegionInput[] {
  if (!Array.isArray(regions) || regions.length > 500) throw new RouteError(400, '修正区域格式无效，或区域数量超过 500 个。')
  const validKinds = new Set(['question', 'solution', 'shared_answer_key'])
  return regions.map((value, index) => {
    const region = value as Partial<CandidateFixRegionInput>
    const sourceDocumentId = String(region?.sourceDocumentId || '')
    if (!pageCountBySourceDocument.has(sourceDocumentId)) throw new RouteError(400, '修正区域必须关联当前候选题所属资料组中的文件。')
    if (!validKinds.has(String(region.kind || ''))) throw new RouteError(400, '修正区域类型无效。')
    if (!Array.isArray(region.segments) || region.segments.length > 30) throw new RouteError(400, '每个修正区域最多允许 30 个框选片段。')
    const pageCount = pageCountBySourceDocument.get(sourceDocumentId) || 0
    const segments = region.segments.map((segment) => {
      const normalized = {
        page: Number(segment?.page), x: Number(segment?.x), y: Number(segment?.y),
        width: Number(segment?.width), height: Number(segment?.height),
      }
      const { page, x, y, width, height } = normalized
      if (![page, x, y, width, height].every(Number.isFinite) || !Number.isInteger(page) || page < 1 || (pageCount > 0 && page > pageCount) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
        throw new RouteError(400, '修正区域含有越界页码或无效坐标。')
      }
      return normalized
    })
    return {
      id: String(region.id || ''), sourceDocumentId, kind: region.kind as CandidateFixRegionInput['kind'],
      questionLabel: String(region.questionLabel || ''), questionKeys: Array.isArray(region.questionKeys) ? region.questionKeys.map(String) : [],
      segments, sortOrder: Number.isFinite(Number(region.sortOrder)) ? Number(region.sortOrder) : index, note: String(region.note || ''),
    }
  })
}
