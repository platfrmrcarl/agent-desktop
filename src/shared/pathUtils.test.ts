import { describe, it, expect } from 'vitest'
import { isChildPath, pathDirname, pathBasename } from './pathUtils'

describe('isChildPath', () => {
  it('detects child path with forward slashes', () => {
    expect(isChildPath('/home/user', '/home/user/file.txt')).toBe(true)
    expect(isChildPath('/home/user', '/home/user/sub/deep/file.txt')).toBe(true)
  })

  it('detects child path with backslashes (Windows)', () => {
    expect(isChildPath('C:\\Users\\foo', 'C:\\Users\\foo\\bar.txt')).toBe(true)
    expect(isChildPath('C:\\Users\\foo', 'C:\\Users\\foo\\sub\\file.txt')).toBe(true)
  })

  it('handles mixed separators', () => {
    expect(isChildPath('C:\\Users\\foo', 'C:\\Users\\foo/bar.txt')).toBe(true)
    expect(isChildPath('/home/user', '/home/user\\file.txt')).toBe(true)
  })

  it('rejects same path (not a child)', () => {
    expect(isChildPath('/home/user', '/home/user')).toBe(false)
    expect(isChildPath('C:\\Users\\foo', 'C:\\Users\\foo')).toBe(false)
  })

  it('rejects sibling with similar prefix', () => {
    expect(isChildPath('/home/user', '/home/user-other/file.txt')).toBe(false)
    expect(isChildPath('/foo/bar', '/foo/bar-baz')).toBe(false)
    expect(isChildPath('C:\\foo\\bar', 'C:\\foo\\bar-baz')).toBe(false)
  })

  it('rejects parent path', () => {
    expect(isChildPath('/home/user/project', '/home/user')).toBe(false)
    expect(isChildPath('/home/user/project', '/home')).toBe(false)
  })

  it('rejects unrelated path', () => {
    expect(isChildPath('/home/user', '/var/log/file.txt')).toBe(false)
    expect(isChildPath('C:\\Users', 'D:\\Data\\file.txt')).toBe(false)
  })
})

describe('pathDirname', () => {
  it('extracts directory with forward slashes', () => {
    expect(pathDirname('/home/user/file.txt')).toBe('/home/user')
    expect(pathDirname('/home/user/sub/file.txt')).toBe('/home/user/sub')
  })

  it('extracts directory with backslashes (Windows)', () => {
    expect(pathDirname('C:\\Users\\foo\\file.txt')).toBe('C:\\Users\\foo')
    expect(pathDirname('C:\\Users\\foo\\sub\\file.txt')).toBe('C:\\Users\\foo\\sub')
  })

  it('returns / for root-level paths', () => {
    expect(pathDirname('/file.txt')).toBe('/')
  })

  it('returns / when no separator found', () => {
    expect(pathDirname('file.txt')).toBe('/')
  })
})

describe('pathBasename', () => {
  it('extracts filename with forward slashes', () => {
    expect(pathBasename('/home/user/file.txt')).toBe('file.txt')
  })

  it('extracts filename with backslashes (Windows)', () => {
    expect(pathBasename('C:\\Users\\foo\\file.txt')).toBe('file.txt')
  })

  it('returns full string when no separator', () => {
    expect(pathBasename('file.txt')).toBe('file.txt')
  })
})
