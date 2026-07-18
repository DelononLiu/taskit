import { describe, it, expect } from 'vitest'
import '../tasks/model_compare/runner.js'
import { MODULES } from '../tasks/registry.js'

describe('model_compare runner', () => {
  const mod = MODULES.model_compare

  it('is registered with correct name', () => {
    expect(mod.name).toBe('模型精度比对')
  })

  it('has a runner configured', () => {
    expect(mod.runner).toBe('onnx')
  })

  it('parser extracts overall and layers from stdout', () => {
    const stdout = {
      overall: { totalLayers: 3, passedLayers: 2, failedLayers: 1 },
      layers: [
        { layerName: 'conv_1', metrics: [] },
        { layerName: 'conv_2', metrics: [] },
      ],
    }
    const result = mod.parser(stdout, {})
    expect(result.overall).toEqual(stdout.overall)
    expect(result.layers).toHaveLength(2)
    expect(result.layers[0].layerName).toBe('conv_1')
  })

  it('parser handles empty stdout gracefully', () => {
    const result = mod.parser({}, {})
    expect(result.overall).toEqual({})
    expect(result.layers).toEqual([])
  })

  it('parser throws on null stdout (caller should pass valid object)', () => {
    expect(() => mod.parser(null, {})).toThrow()
  })

  it('parser preserves layer structure when metrics are empty', () => {
    const stdout = {
      layers: [
        { layerName: 'conv_1', layerType: 'Conv', inputShape: [1, 3, 224, 224], outputShape: [1, 64, 112, 112], metrics: [] },
      ],
    }
    const result = mod.parser(stdout, {})
    expect(result.layers[0].layerName).toBe('conv_1')
    expect(result.layers[0].layerType).toBe('Conv')
    expect(result.layers[0].metrics).toEqual([])
  })
})
