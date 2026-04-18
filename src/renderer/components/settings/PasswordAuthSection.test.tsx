import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PasswordAuthSection } from './PasswordAuthSection'

function installMockAgent(isSet = false) {
  const api = {
    isPasswordSet: vi.fn(async () => isSet),
    setPassword: vi.fn(async () => {}),
    clearPassword: vi.fn(async () => {}),
    getSessionDurationDays: vi.fn(async () => 7),
    setSessionDurationDays: vi.fn(async () => {}),
    getRememberDurationDays: vi.fn(async () => 30),
    setRememberDurationDays: vi.fn(async () => {}),
  }
  ;(window as any).agent = { server: api }
  return api
}

describe('PasswordAuthSection', () => {
  beforeEach(() => { installMockAgent(false) })

  it('renders Disabled when no password is set', async () => {
    render(<PasswordAuthSection accessMode="lan" />)
    await waitFor(() => expect(screen.getByText(/Password authentication/i)).toBeInTheDocument())
    expect(screen.getByText(/Disabled/i)).toBeInTheDocument()
  })

  it('shows Set password button when disabled', async () => {
    render(<PasswordAuthSection accessMode="lan" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Set password/i })).toBeInTheDocument())
  })

  it('shows warning when accessMode=all and no password', async () => {
    render(<PasswordAuthSection accessMode="all" />)
    await waitFor(() => expect(screen.getByText(/Internet access enabled without a password/i)).toBeInTheDocument())
  })

  it('shows Change/Disable buttons when password is set', async () => {
    installMockAgent(true)
    render(<PasswordAuthSection accessMode="lan" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Change password/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Disable/i })).toBeInTheDocument()
  })

  it('clicking Disable calls clearPassword', async () => {
    const api = installMockAgent(true)
    window.confirm = vi.fn(() => true)
    render(<PasswordAuthSection accessMode="lan" />)
    const btn = await screen.findByRole('button', { name: /Disable/i })
    fireEvent.click(btn)
    await waitFor(() => expect(api.clearPassword).toHaveBeenCalled())
  })
})
