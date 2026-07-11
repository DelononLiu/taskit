import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

afterEach(cleanup)

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>hello world</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('hello world')).toBeDefined()
  })

  it('catches errors and shows fallback UI', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const Broken = () => { throw new Error('test crash') }

    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    )

    expect(screen.getByText('应用出现异常')).toBeDefined()
    expect(screen.getByText('test crash')).toBeDefined()
    expect(screen.getByText('重试')).toBeDefined()
    expect(screen.getByText('刷新页面')).toBeDefined()

    spy.mockRestore()
  })

  it('shows custom fallback when provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const Broken = () => { throw new Error('custom') }

    render(
      <ErrorBoundary fallback={<div>Custom Error UI</div>}>
        <Broken />
      </ErrorBoundary>
    )

    expect(screen.getByText('Custom Error UI')).toBeDefined()

    spy.mockRestore()
  })
})
