export interface ManualFixSegment {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface ManualFixRegion {
  id: string
  sourceRunId: string
  kind: 'question' | 'solution' | 'shared_answer_key'
  questionLabel: string
  questionKeys?: string[]
  segments: ManualFixSegment[]
  sortOrder: number
  note: string
}

export type ManualFixTab = 'content' | 'regions' | 'figures'
