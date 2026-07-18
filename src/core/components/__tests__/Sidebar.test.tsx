import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Sidebar } from '@/core/components/Sidebar'

afterEach(cleanup)

describe('Sidebar', () => {
  // ── 1. Section labels ─────────────────────────────────────────────
  describe('section labels', () => {
    it('renders "模型工具" and "通用" section headers', () => {
      render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={vi.fn()}
        />,
      )

      expect(screen.getByText('模型工具')).toBeDefined()
      expect(screen.getByText('通用')).toBeDefined()
    })
  })

  // ── 2. Module rendering ──────────────────────────────────────────
  describe('module rendering', () => {
    it('renders the active module "ModelCompare" with highlight classes', () => {
      const { container } = render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={vi.fn()}
        />,
      )

      const btn = screen.getByText('ModelCompare').closest('button')!
      expect(btn.className).toContain('bg-sky-50')
      expect(btn.className).toContain('text-brand-accent')
      expect(btn.className).toContain('font-bold')
      expect(btn.className).toContain('border')
      // Active button should NOT be disabled
      expect(btn.getAttribute('disabled')).toBeNull()
    })

    it('renders the disabled module "部署工坊" with "即将上线" badge', () => {
      const { container } = render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={vi.fn()}
        />,
      )

      // Disabled button has muted classes
      const btn = screen.getByText('部署工坊').closest('button')!
      expect(btn.className).toContain('text-slate-400')
      expect(btn.className).toContain('cursor-not-allowed')
      // Button is disabled
      expect(btn.getAttribute('disabled')).not.toBeNull()

      // "即将上线" badge is rendered
      expect(screen.getByText('即将上线')).toBeDefined()
    })

    it('does NOT render highlight classes on non-active module', () => {
      render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={vi.fn()}
        />,
      )

      const btn = screen.getByText('部署工坊').closest('button')!
      expect(btn.className).not.toContain('bg-sky-50')
      expect(btn.className).not.toContain('text-brand-accent')
      expect(btn.className).not.toContain('font-bold')
    })
  })

  // ── 3. Module click ──────────────────────────────────────────────
  describe('module click', () => {
    it('calls onModuleChange with "model-compare" when the active module is clicked', () => {
      const onModuleChange = vi.fn()
      render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={onModuleChange}
        />,
      )

      fireEvent.click(screen.getByText('ModelCompare'))
      expect(onModuleChange).toHaveBeenCalledTimes(1)
      expect(onModuleChange).toHaveBeenCalledWith('model-compare')
    })

    it('does NOT call onModuleChange when the disabled module "部署工坊" is clicked', () => {
      const onModuleChange = vi.fn()
      render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={onModuleChange}
        />,
      )

      fireEvent.click(screen.getByText('部署工坊'))
      expect(onModuleChange).not.toHaveBeenCalled()
    })
  })

  // ── 4. General section buttons ───────────────────────────────────
  describe('general section buttons', () => {
    it('renders "全部任务记录" button', () => {
      render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={vi.fn()}
        />,
      )

      expect(screen.getByText('全部任务记录')).toBeDefined()
    })

    it('renders "导出报告" button', () => {
      render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={vi.fn()}
        />,
      )

      expect(screen.getByText('导出报告')).toBeDefined()
    })
  })

  // ── 5. System info ───────────────────────────────────────────────
  describe('system info', () => {
    it('renders "Backend Node" label and IP "10.128.4.15"', () => {
      render(
        <Sidebar
          activeModule="model-compare"
          onModuleChange={vi.fn()}
        />,
      )

      expect(screen.getByText('Backend Node')).toBeDefined()
      expect(screen.getByText('10.128.4.15')).toBeDefined()
    })
  })
})
