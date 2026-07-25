import { describe, expect, it } from 'vitest'
import { provinceForCity } from './metadataOptions'

describe('provinceForCity', () => {
  it('maps a city to its configured province', () => {
    expect(provinceForCity('成都')).toBe('四川')
    expect(provinceForCity('邢台')).toBe('河北')
  })

  it('returns an empty value for unknown cities', () => {
    expect(provinceForCity('')).toBe('')
    expect(provinceForCity('不存在的城市')).toBe('')
  })
})
