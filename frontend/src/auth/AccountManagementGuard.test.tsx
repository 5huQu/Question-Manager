import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountManagementGuard } from './AccountManagementGuard'
import { AccountManagementCard } from '@/pages/settings/AccountManagementCard'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ accountManagementAvailable: true }))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    accountManagementAvailable: mocks.accountManagementAvailable,
    admin: { username: 'admin' },
    logout: vi.fn().mockResolvedValue(undefined),
  }),
}))

function Location() {
  return <div data-location>{useLocation().pathname}</div>
}

describe('account management capability guard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.accountManagementAvailable = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows the account card and permits guarded routes when available', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/settings/change-password']}>
          <AccountManagementCard />
          <Routes>
            <Route path="/settings/change-password" element={<AccountManagementGuard><div>密码页面</div></AccountManagementGuard>} />
            <Route path="/settings" element={<Location />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    expect(container.textContent).toContain('账号与安全')
    expect(container.textContent).toContain('密码页面')
  })

  it('hides the card and redirects direct routes when unavailable', () => {
    mocks.accountManagementAvailable = false
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/settings/sessions']}>
          <AccountManagementCard />
          <Routes>
            <Route path="/settings/sessions" element={<AccountManagementGuard><div>会话页面</div></AccountManagementGuard>} />
            <Route path="/settings" element={<Location />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    expect(container.textContent).not.toContain('账号与安全')
    expect(container.textContent).not.toContain('会话页面')
    expect(container.querySelector('[data-location]')?.textContent).toBe('/settings')
  })
})
