import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EmptyState } from '@/core/components/EmptyState'

afterEach(cleanup)

describe('EmptyState', () => {
  it('renders title and default icon, no button or description when not provided', () => {
    render(<EmptyState title="No results" />)

    expect(screen.getByText('No results')).toBeDefined()
    expect(screen.getByText('📋')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('paragraph')).toBeNull()
  })

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Nothing here." />)

    const p = screen.getByText('Nothing here.')
    expect(p.tagName).toBe('P')
  })

  it('does not render description when empty string', () => {
    render(<EmptyState title="Empty" description="" />)
    expect(screen.queryByRole('paragraph')).toBeNull()
  })

  it('renders button when both actionLabel and onAction provided, click fires callback', () => {
    const onAction = vi.fn()
    render(<EmptyState title="No data" actionLabel="Create" onAction={onAction} />)

    const button = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(button)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: 'only actionLabel', actionLabel: 'Create', onAction: undefined },
    { label: 'only onAction', actionLabel: undefined, onAction: () => {} },
    { label: 'empty actionLabel', actionLabel: '', onAction: () => {} },
  ])('no button when $label', ({ actionLabel, onAction }) => {
    render(<EmptyState title="No data" actionLabel={actionLabel} onAction={onAction} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
