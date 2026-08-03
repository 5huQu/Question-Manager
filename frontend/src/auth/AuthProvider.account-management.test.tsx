import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  bootstrapAdmin: vi.fn(),
}))

vi.mock('./authApi', () => mocks)

function Harness() {
  const { phase, logout } = useAuth()
  return <button type="button" data-phase={phase} onClick={() => void logout()}>退出</button>
}

describe('AuthProvider account management capability', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.getAuthState.mockResolvedValue({
      initialized: true,
      authenticated: true,
      admin: { username: 'local' },
      csrfToken: '',
      accountManagementAvailable: false,
    })
    mocks.logout.mockResolvedValue({ ok: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('does not call logout API when account management is unavailable', async () => {
    await act(async () => {
      root.render(<MemoryRouter><AuthProvider><Harness /></AuthProvider></MemoryRouter>)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mocks.logout).not.toHaveBeenCalled()
  })

  it('keeps web single-admin logout behavior when available', async () => {
    mocks.getAuthState.mockResolvedValue({
      initialized: true,
      authenticated: true,
      admin: { username: 'admin' },
      csrfToken: 'csrf',
      accountManagementAvailable: true,
    })
    await act(async () => {
      root.render(<MemoryRouter><AuthProvider><Harness /></AuthProvider></MemoryRouter>)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mocks.logout).toHaveBeenCalledTimes(1)
  })
})
