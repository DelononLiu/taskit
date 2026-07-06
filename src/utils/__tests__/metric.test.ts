import { describe, it, expect } from 'vitest'
import { formatMetricValue, getPassColor } from '@/utils/metric'

describe('formatMetricValue', () => {
  it('formats cosine_similarity to 6 decimal places', () => {
    expect(formatMetricValue('cosine_similarity', 0.999999)).toBe('0.999999')
    expect(formatMetricValue('cosine_similarity', 0.1234567)).toBe('0.123457')
  })

  it('formats error metrics to exponential notation', () => {
    expect(formatMetricValue('max_abs_error', 0.000123)).toBe('1.2300e-4')
    expect(formatMetricValue('mean_abs_error', 0.001)).toBe('1.0000e-3')
    expect(formatMetricValue('relative_error', 0.05)).toBe('5.0000e-2')
  })

  it('formats snr with dB unit', () => {
    expect(formatMetricValue('snr', 44.9)).toBe('44.9 dB')
    expect(formatMetricValue('snr', 3.2)).toBe('3.2 dB')
  })

  it('handles fallback for unknown type', () => {
    expect(formatMetricValue('unknown' as any, 42)).toBe('42')
  })
})

describe('getPassColor', () => {
  it('returns green when passed is true', () => {
    expect(getPassColor(true, true, 0.5, 0.99)).toBe('#52c41a')
    expect(getPassColor(true, false, 0.5, 0.99)).toBe('#52c41a')
  })

  it('returns red when not passed and higherIsBetter with value < threshold', () => {
    expect(getPassColor(false, true, 0.5, 0.99)).toBe('#ff4d4f')
  })

  it('returns yellow when not passed but not the higherIsBetter case', () => {
    expect(getPassColor(false, false, 0.5, 0.99)).toBe('#faad14')
  })
})
