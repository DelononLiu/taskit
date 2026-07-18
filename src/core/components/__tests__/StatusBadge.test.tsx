import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusBadge } from '@/core/components/StatusBadge'
import type { TaskStatus } from '@/types'

afterEach(cleanup)

describe('StatusBadge', () => {
  const cases: Array<{ status: TaskStatus; label: string; icon: string; styleClass: string }> = [
    { status: 'completed', label: 'READY', icon: '●', styleClass: 'text-brand-success' },
    { status: 'running', label: 'COMPILING', icon: '◌', styleClass: 'text-slate-600' },
    { status: 'pending', label: 'PENDING', icon: '▲', styleClass: 'text-amber-700' },
    { status: 'failed', label: 'FAILED', icon: '✕', styleClass: 'text-red-700' },
    { status: 'cancelled', label: 'CANCELLED', icon: '—', styleClass: 'text-slate-500' },
  ]

  it.each(cases)(
    'renders label "$label" and icon "$icon" for $status status',
    ({ status, label, icon, styleClass }) => {
      const { container } = render(<StatusBadge status={status} />)

      // Label text is rendered
      expect(screen.getByText(label)).toBeDefined()

      // Icon character is rendered (inside the inner <span>)
      expect(screen.getByText(icon)).toBeDefined()

      // Status-specific color class is present on the outer span
      const outerSpan = container.firstChild as HTMLElement
      expect(outerSpan.className).toContain(styleClass)
    },
  )

  it('every TaskStatus union member renders without crashing', () => {
    const allStatuses: TaskStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled']

    for (const status of allStatuses) {
      expect(() => {
        const { container } = render(<StatusBadge status={status} />)
        expect(container.firstChild).not.toBeNull()
      }).not.toThrow()
    }
  })
})
