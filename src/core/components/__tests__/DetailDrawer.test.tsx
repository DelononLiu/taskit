import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DetailDrawer } from '@/core/components/DetailDrawer'

afterEach(cleanup)

describe('DetailDrawer', () => {
  const baseProps = {
    onClose: () => {},
    children: <div>Test Child Content</div>,
  }

  describe('closed state', () => {
    it('renders panel with translate-x-full class and no backdrop', () => {
      const { container } = render(
        <DetailDrawer {...baseProps} open={false} mode="new-task" title="T" />,
      )
      const panel = container.querySelector('aside')!
      expect(panel.className).toContain('translate-x-full')
      expect(panel.className).not.toContain('translate-x-0')
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    })
  })

  describe('open state', () => {
    it('renders panel visible with backdrop and correct aria attributes', () => {
      const { container } = render(
        <DetailDrawer {...baseProps} open={true} mode="new-task" title="My Title" />,
      )
      // Panel is visible
      const panel = screen.getByRole('dialog')
      expect(panel.className).toContain('translate-x-0')
      expect(panel.className).not.toContain('translate-x-full')

      // Aria attributes
      expect(panel.getAttribute('aria-modal')).toBe('true')
      expect(panel.getAttribute('aria-label')).toBe('My Title')

      // Backdrop is present
      const backdrop = container.querySelector('[aria-hidden="true"]')
      expect(backdrop).not.toBeNull()
    })
  })

  describe('mode labels', () => {
    it('shows "NEW TASK" for new-task mode', () => {
      render(<DetailDrawer {...baseProps} open={true} mode="new-task" title="T" />)
      expect(screen.getByText('NEW TASK')).toBeDefined()
    })

    it('shows "TASK INSPECTOR" for task-detail mode', () => {
      render(<DetailDrawer {...baseProps} open={true} mode="task-detail" title="T" />)
      expect(screen.getByText('TASK INSPECTOR')).toBeDefined()
    })
  })

  describe('title', () => {
    it('renders the title prop in an h3 element', () => {
      render(<DetailDrawer {...baseProps} open={true} mode="new-task" title="Custom Title" />)
      const heading = screen.getByText('Custom Title')
      expect(heading.tagName).toBe('H3')
    })
  })

  describe('children', () => {
    it('renders children inside the drawer body', () => {
      render(
        <DetailDrawer {...baseProps} open={true} mode="new-task" title="T">
          <span>Child Element</span>
        </DetailDrawer>,
      )
      expect(screen.getByText('Child Element')).toBeDefined()
    })
  })

  describe('close button', () => {
    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(
        <DetailDrawer {...baseProps} open={true} mode="new-task" title="T" onClose={onClose} />,
      )
      fireEvent.click(screen.getByRole('button'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('backdrop click', () => {
    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn()
      const { container } = render(
        <DetailDrawer {...baseProps} open={true} mode="new-task" title="T" onClose={onClose} />,
      )
      const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement
      fireEvent.click(backdrop)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('escape key', () => {
    it('calls onClose when Escape key is pressed on the dialog', () => {
      const onClose = vi.fn()
      render(
        <DetailDrawer {...baseProps} open={true} mode="new-task" title="T" onClose={onClose} />,
      )
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('focus management', () => {
    it('focuses the close button when drawer opens', () => {
      const { rerender } = render(
        <DetailDrawer {...baseProps} open={false} mode="new-task" title="T" />,
      )
      // Re-render with open=true to trigger the focus effect
      rerender(<DetailDrawer {...baseProps} open={true} mode="new-task" title="T" />)
      expect(document.activeElement).toBe(screen.getByRole('button'))
    })
  })
})
