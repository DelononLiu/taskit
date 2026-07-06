import { describe, it, expect } from 'vitest'
import { getFrameworkColor, diffToColor } from '@/utils/color'

describe('getFrameworkColor', () => {
  it('returns blue for onnxruntime', () => {
    expect(getFrameworkColor('onnxruntime')).toBe('#1677ff')
  })

  it('returns purple for tensorrt', () => {
    expect(getFrameworkColor('tensorrt')).toBe('#722ed1')
  })

  it('returns orange for openvino', () => {
    expect(getFrameworkColor('openvino')).toBe('#fa8c16')
  })

  it('returns fallback #666 for unknown framework', () => {
    expect(getFrameworkColor('unknown')).toBe('#666')
  })
})

describe('diffToColor', () => {
  it('returns green when value >= threshold', () => {
    expect(diffToColor(0.995, 0.99)).toBe('#52c41a')
    expect(diffToColor(0.99, 0.99)).toBe('#52c41a')
  })

  it('returns yellow when value >= 90% of threshold', () => {
    expect(diffToColor(0.95, 0.99)).toBe('#faad14')
    expect(diffToColor(0.891, 0.99)).toBe('#faad14')
  })

  it('returns red when value < 90% of threshold', () => {
    expect(diffToColor(0.89, 0.99)).toBe('#ff4d4f')
    expect(diffToColor(0.5, 0.99)).toBe('#ff4d4f')
  })
})
