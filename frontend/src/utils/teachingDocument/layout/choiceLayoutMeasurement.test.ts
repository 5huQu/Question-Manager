import { describe, expect, it } from 'vitest'
import { measuredChoiceLayoutOverrides } from './choiceLayoutMeasurement'
import { TEACHING_DOM } from './domContract'

describe('measuredChoiceLayoutOverrides', () => {
  it('preserves an already confirmed layout during the fixed-layout render pass', () => {
    const root = document.createElement('div')
    root.innerHTML = `<div ${TEACHING_DOM.questionChoiceLayoutBlockId}="question-1" ${TEACHING_DOM.questionChoiceLayout}="two"></div>`

    expect(measuredChoiceLayoutOverrides(root, { 'question-1': 'double' }))
      .toEqual({ 'question-1': 'double' })
  })

  it('only accepts adaptive results for a new measurement', () => {
    const root = document.createElement('div')
    root.innerHTML = `<div ${TEACHING_DOM.questionChoiceLayoutBlockId}="question-1" ${TEACHING_DOM.questionChoiceLayout}="adaptive-2"></div>`

    expect(measuredChoiceLayoutOverrides(root)).toEqual({ 'question-1': 'double' })
  })
})
