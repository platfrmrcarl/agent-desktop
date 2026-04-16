import { describe, it, expect } from 'vitest'
import { tokenize } from './syntax'

describe('tokenize', () => {
  it('returns a single lit token for plain text', () => {
    expect(tokenize('hello world')).toEqual([
      { type: 'lit', value: 'hello world' },
    ])
  })

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([])
  })

  it('tokenizes a single variable without args', () => {
    expect(tokenize('{name}')).toEqual([
      { type: 'var', name: 'name', args: [], raw: '{name}' },
    ])
  })

  it('tokenizes a variable surrounded by text', () => {
    expect(tokenize('Hello {name}!')).toEqual([
      { type: 'lit', value: 'Hello ' },
      { type: 'var', name: 'name', args: [], raw: '{name}' },
      { type: 'lit', value: '!' },
    ])
  })

  it('tokenizes a variable with one argument', () => {
    expect(tokenize('{today_date:DD/MM}')).toEqual([
      { type: 'var', name: 'today_date', args: ['DD/MM'], raw: '{today_date:DD/MM}' },
    ])
  })

  it('tokenizes a variable with multiple arguments', () => {
    expect(tokenize('{random:1:100}')).toEqual([
      { type: 'var', name: 'random', args: ['1', '100'], raw: '{random:1:100}' },
    ])
  })

  it('tokenizes empty args explicitly', () => {
    expect(tokenize('{x:}')).toEqual([
      { type: 'var', name: 'x', args: [''], raw: '{x:}' },
    ])
  })

  it('tokenizes two adjacent variables', () => {
    expect(tokenize('{a}{b}')).toEqual([
      { type: 'var', name: 'a', args: [], raw: '{a}' },
      { type: 'var', name: 'b', args: [], raw: '{b}' },
    ])
  })

  it('does not match names with spaces', () => {
    expect(tokenize('{ foo }')).toEqual([
      { type: 'lit', value: '{ foo }' },
    ])
  })

  it('does not match names starting with digit', () => {
    expect(tokenize('{1foo}')).toEqual([
      { type: 'lit', value: '{1foo}' },
    ])
  })

  it('supports underscore and digits in names', () => {
    expect(tokenize('{today_date_2}')).toEqual([
      { type: 'var', name: 'today_date_2', args: [], raw: '{today_date_2}' },
    ])
  })

  it('keeps literal text between variables', () => {
    expect(tokenize('A{x}B{y}C')).toEqual([
      { type: 'lit', value: 'A' },
      { type: 'var', name: 'x', args: [], raw: '{x}' },
      { type: 'lit', value: 'B' },
      { type: 'var', name: 'y', args: [], raw: '{y}' },
      { type: 'lit', value: 'C' },
    ])
  })

  it('accepts accented characters and symbols inside args', () => {
    expect(tokenize('{weather:Paris é}')).toEqual([
      { type: 'var', name: 'weather', args: ['Paris é'], raw: '{weather:Paris é}' },
    ])
  })

  it('preserves lone closing brace as literal', () => {
    expect(tokenize('text}more')).toEqual([
      { type: 'lit', value: 'text}more' },
    ])
  })

  it('handles mix of invalid and valid patterns', () => {
    expect(tokenize('{ foo }{bar}')).toEqual([
      { type: 'lit', value: '{ foo }' },
      { type: 'var', name: 'bar', args: [], raw: '{bar}' },
    ])
  })

  it('handles variable at end of string', () => {
    expect(tokenize('hello {name}')).toEqual([
      { type: 'lit', value: 'hello ' },
      { type: 'var', name: 'name', args: [], raw: '{name}' },
    ])
  })
})
