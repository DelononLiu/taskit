import { describe, it, expect } from 'vitest'
import { useAppStore } from '@/stores/appStore'

describe('appStore', () => {
  describe('initial state', () => {
    it('defaults activeModule to model-compare', () => {
      expect(useAppStore.getState().activeModule).toBe('model-compare')
    })
  })

  describe('setActiveModule', () => {
    it('changes activeModule to the given module id', () => {
      useAppStore.getState().setActiveModule('deploy-agent')
      expect(useAppStore.getState().activeModule).toBe('deploy-agent')
    })

    it('switching to the same module is idempotent', () => {
      useAppStore.getState().setActiveModule('model-compare')
      expect(useAppStore.getState().activeModule).toBe('model-compare')
    })
  })
})
