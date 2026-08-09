import { api, jsonHeaders } from './client'

export type AiAssistantQuestionContent = {
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
}

export type AiAssistantContentFormatResult = {
  content: AiAssistantQuestionContent
  model: string
}

export const aiAssistantApi = {
  formatQuestionContent(content: AiAssistantQuestionContent) {
    return api<AiAssistantContentFormatResult>('/api/ai-assistant/format-question-content', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(content),
    })
  },
}
