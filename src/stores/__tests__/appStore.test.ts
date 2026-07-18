import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/stores/appStore'

describe('appStore', () => {
  // Reset store to initial state before each test
  beforeEach(() => {
    useAppStore.setState({
      activeModule: 'model-compare',
      drawerMode: 'closed',
      drawerTaskId: null,
      drawerTitle: '',
    })
  })

  describe('initial state', () => {
    it('defaults activeModule to model-compare', () => {
      expect(useAppStore.getState().activeModule).toBe('model-compare')
    })

    it('defaults drawerMode to closed', () => {
      expect(useAppStore.getState().drawerMode).toBe('closed')
    })

    it('defaults drawerTaskId to null', () => {
      expect(useAppStore.getState().drawerTaskId).toBeNull()
    })

    it('defaults drawerTitle to empty string', () => {
      expect(useAppStore.getState().drawerTitle).toBe('')
    })
  })

  describe('setActiveModule', () => {
    it('changes activeModule to the given module id', () => {
      useAppStore.getState().setActiveModule('deploy-agent')
      expect(useAppStore.getState().activeModule).toBe('deploy-agent')
    })

    it('closes the drawer when switching modules', () => {
      // Arrange: drawer is open
      useAppStore.getState().openDrawer('new-task', 42, 'Some Task')

      // Act: switch module
      useAppStore.getState().setActiveModule('deploy-agent')

      // Assert: drawer is closed and cleared
      const state = useAppStore.getState()
      expect(state.drawerMode).toBe('closed')
      expect(state.drawerTaskId).toBeNull()
      expect(state.drawerTitle).toBe('')
    })

    it('switching to the same module also closes the drawer', () => {
      // Arrange: drawer is open
      useAppStore.getState().openDrawer('task-detail', 7, 'Inspect')

      // Act: "switch" to current module
      useAppStore.getState().setActiveModule('model-compare')

      // Assert: drawer still closes
      const state = useAppStore.getState()
      expect(state.drawerMode).toBe('closed')
      expect(state.drawerTaskId).toBeNull()
      expect(state.drawerTitle).toBe('')
    })
  })

  describe('openDrawer', () => {
    it('opens drawer with new-task mode and populates taskId and title', () => {
      useAppStore.getState().openDrawer('new-task', 1, 'New Benchmark')

      const state = useAppStore.getState()
      expect(state.drawerMode).toBe('new-task')
      expect(state.drawerTaskId).toBe(1)
      expect(state.drawerTitle).toBe('New Benchmark')
    })

    it('opens drawer with task-detail mode and populates taskId and title', () => {
      useAppStore.getState().openDrawer('task-detail', 2, 'Result Review')

      const state = useAppStore.getState()
      expect(state.drawerMode).toBe('task-detail')
      expect(state.drawerTaskId).toBe(2)
      expect(state.drawerTitle).toBe('Result Review')
    })

    it('defaults drawerTaskId to null when taskId is omitted', () => {
      useAppStore.getState().openDrawer('new-task')

      expect(useAppStore.getState().drawerTaskId).toBeNull()
    })

    it('defaults drawerTitle to empty string when title is omitted', () => {
      useAppStore.getState().openDrawer('new-task')

      expect(useAppStore.getState().drawerTitle).toBe('')
    })

    it('preserves 0 as a valid taskId value (not treated as falsy)', () => {
      // 0 is a valid number; the ?? operator keeps it
      useAppStore.getState().openDrawer('new-task', 0, 'Zero ID')

      expect(useAppStore.getState().drawerTaskId).toBe(0)
    })
  })

  describe('closeDrawer', () => {
    it('resets drawerMode to closed', () => {
      useAppStore.getState().openDrawer('new-task', 1, 'Test')
      useAppStore.getState().closeDrawer()

      expect(useAppStore.getState().drawerMode).toBe('closed')
    })

    it('clears drawerTaskId to null', () => {
      useAppStore.getState().openDrawer('new-task', 1, 'Test')
      useAppStore.getState().closeDrawer()

      expect(useAppStore.getState().drawerTaskId).toBeNull()
    })

    it('clears drawerTitle to empty string', () => {
      useAppStore.getState().openDrawer('new-task', 1, 'Test')
      useAppStore.getState().closeDrawer()

      expect(useAppStore.getState().drawerTitle).toBe('')
    })
  })

  describe('edge cases', () => {
    it('open then close then open again transitions correctly', () => {
      const store = useAppStore.getState()

      // First open
      store.openDrawer('new-task', 1, 'First')
      expect(useAppStore.getState().drawerMode).toBe('new-task')
      expect(useAppStore.getState().drawerTaskId).toBe(1)
      expect(useAppStore.getState().drawerTitle).toBe('First')

      // Close
      store.closeDrawer()
      expect(useAppStore.getState().drawerMode).toBe('closed')

      // Re-open with different mode and values
      store.openDrawer('task-detail', 2, 'Second')
      expect(useAppStore.getState().drawerMode).toBe('task-detail')
      expect(useAppStore.getState().drawerTaskId).toBe(2)
      expect(useAppStore.getState().drawerTitle).toBe('Second')
    })

    it('openDrawer without taskId resets a previously set drawerTaskId to null', () => {
      // Open with a taskId
      useAppStore.getState().openDrawer('new-task', 42, 'Title')
      expect(useAppStore.getState().drawerTaskId).toBe(42)

      // Re-open without taskId — should reset to null via ?? null
      useAppStore.getState().openDrawer('task-detail')
      expect(useAppStore.getState().drawerTaskId).toBeNull()
    })

    it('closeDrawer is idempotent when already closed', () => {
      useAppStore.getState().closeDrawer()

      const state = useAppStore.getState()
      expect(state.drawerMode).toBe('closed')
      expect(state.drawerTaskId).toBeNull()
      expect(state.drawerTitle).toBe('')
    })
  })
})
