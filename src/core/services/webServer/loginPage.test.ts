import { describe, it, expect } from 'vitest'
import { renderLoginPage } from './loginPage'

describe('renderLoginPage', () => {
  it('returns HTML with a password input', () => {
    const html = renderLoginPage({})
    expect(html).toContain('<input')
    expect(html).toContain('type="password"')
    expect(html).toContain('action="/login"')
    expect(html).toContain('name="remember"')
  })

  it('renders an error message when provided', () => {
    const html = renderLoginPage({ error: 'Bad password' })
    expect(html).toContain('Bad password')
  })

  it('escapes HTML in the error message', () => {
    const html = renderLoginPage({ error: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('includes retry timer when provided', () => {
    const html = renderLoginPage({ error: 'Too many attempts', retryAfter: 42 })
    expect(html).toContain('retry in 42s')
  })
})
