import { describe, it, expect } from 'vitest'
import {
  isPathOutsideCwd,
  isPathOutsideAllowed,
  isPathOutsideReadAllowed,
  isPathOutsideWriteAllowed,
  extractBashWritePaths,
  extractBashReadPaths,
} from './cwdGuard'

describe('isPathOutsideCwd', () => {
  it('returns null when the path is inside CWD', () => {
    expect(isPathOutsideCwd('foo.ts', '/project')).toBe(null)
    expect(isPathOutsideCwd('/project/sub/bar.ts', '/project')).toBe(null)
  })
  it('returns the resolved path when outside CWD', () => {
    expect(isPathOutsideCwd('/etc/passwd', '/project')).toBe('/etc/passwd')
  })
  it('returns null when path equals CWD', () => {
    expect(isPathOutsideCwd('/project', '/project')).toBe(null)
  })
})

describe('isPathOutsideAllowed', () => {
  it('permits CWD', () => {
    expect(isPathOutsideAllowed('/project/x', '/project')).toBe(null)
  })
  it('permits any additional path', () => {
    expect(isPathOutsideAllowed('/data/x', '/project', ['/data'])).toBe(null)
  })
  it('denies when outside all', () => {
    expect(isPathOutsideAllowed('/tmp/x', '/project', ['/data'])).toBe('/tmp/x')
  })
})

describe('isPathOutsideReadAllowed', () => {
  it('permits read-only whitelist entry', () => {
    expect(isPathOutsideReadAllowed('/data/x', '/project', [{ path: '/data', access: 'read' }])).toBe(null)
  })
  it('permits readwrite whitelist entry', () => {
    expect(isPathOutsideReadAllowed('/data/x', '/project', [{ path: '/data', access: 'readwrite' }])).toBe(null)
  })
})

describe('isPathOutsideWriteAllowed', () => {
  it('denies read-only whitelist entry for writes', () => {
    expect(isPathOutsideWriteAllowed('/data/x', '/project', [{ path: '/data', access: 'read' }])).toBe('/data/x')
  })
  it('permits readwrite whitelist entry for writes', () => {
    expect(isPathOutsideWriteAllowed('/data/x', '/project', [{ path: '/data', access: 'readwrite' }])).toBe(null)
  })
})

describe('extractBashWritePaths', () => {
  it('extracts redirections', () => {
    expect(extractBashWritePaths('echo x > /tmp/out')).toEqual(['/tmp/out'])
  })
  it('extracts cp destination', () => {
    expect(extractBashWritePaths('cp a.txt b.txt')).toEqual(['b.txt'])
  })
})

describe('extractBashReadPaths', () => {
  it('extracts cat arguments', () => {
    expect(extractBashReadPaths('cat /etc/passwd')).toEqual(['/etc/passwd'])
  })
  it('extracts find search path', () => {
    expect(extractBashReadPaths('find /home -name "*.ts"')).toEqual(['/home'])
  })
})
