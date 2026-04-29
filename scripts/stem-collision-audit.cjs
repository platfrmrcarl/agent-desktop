#!/usr/bin/env node
/**
 * Audit C: stem name collisions across canonical dirs.
 *
 * For each filename stem (e.g. `messages`, `tts`, `system`), list which of
 * these directories contain a file with that stem:
 *
 *   - src/core/handlers/      (canonical new home — dispatch handlers)
 *   - src/core/services/      (legacy core services)
 *   - src/main/services/      (Electron-specific services)
 *
 * For each collision, show the duplicated EXPORTED symbol names (cases where
 * both files export the same function/class/const).
 *
 * This is the "is this another messages.ts hidden in plain sight?" check.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')

const TARGET_DIRS = [
  ['core/handlers', path.join(ROOT, 'src/core/handlers')],
  ['core/services', path.join(ROOT, 'src/core/services')],
  ['main/services', path.join(ROOT, 'src/main/services')],
]

function listProdFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && /\.tsx?$/.test(e.name))
    .filter(e => !e.name.endsWith('.d.ts'))
    .filter(e => !/\.(test|spec|integration\.test)\.tsx?$/.test(e.name))
    .map(e => e.name)
}

function getExportedSymbols(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8')
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
  const exports = []

  function pushIfNamed(node, kind) {
    if (node.name) {
      const name = node.name.getText()
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      exports.push({ name, kind, line: line + 1 })
    }
  }

  function visit(node) {
    const hasExport = node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!hasExport) {
      // Also handle `export { foo, bar }` and `export const ...`
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const spec of node.exportClause.elements) {
          const { line } = sf.getLineAndCharacterOfPosition(spec.getStart(sf))
          exports.push({ name: spec.name.getText(), kind: 'reexport', line: line + 1 })
        }
      }
      return
    }
    if (ts.isFunctionDeclaration(node)) pushIfNamed(node, 'function')
    else if (ts.isClassDeclaration(node)) pushIfNamed(node, 'class')
    else if (ts.isInterfaceDeclaration(node)) pushIfNamed(node, 'interface')
    else if (ts.isTypeAliasDeclaration(node)) pushIfNamed(node, 'type')
    else if (ts.isEnumDeclaration(node)) pushIfNamed(node, 'enum')
    else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const { line } = sf.getLineAndCharacterOfPosition(decl.getStart(sf))
          exports.push({ name: decl.name.getText(), kind: 'const', line: line + 1 })
        }
      }
    }
  }

  ts.forEachChild(sf, visit)
  return exports
}

// Collect: stem -> dir -> { file, exports[] }
const byStem = new Map()

for (const [label, dir] of TARGET_DIRS) {
  for (const fileName of listProdFiles(dir)) {
    const stem = fileName.replace(/\.tsx?$/, '')
    if (!byStem.has(stem)) byStem.set(stem, new Map())
    const fullPath = path.join(dir, fileName)
    const exports = getExportedSymbols(fullPath)
    byStem.get(stem).set(label, {
      relpath: path.relative(ROOT, fullPath),
      exports,
    })
  }
}

// Filter: collisions only (stem in 2+ dirs)
const collisions = [...byStem.entries()].filter(([_, dirMap]) => dirMap.size >= 2)

// Sort by severity: 3-dir collisions first, then by count of duplicated exports
function dupExportCount(dirMap) {
  const counts = new Map()
  for (const { exports } of dirMap.values()) {
    for (const e of exports) {
      counts.set(e.name, (counts.get(e.name) || 0) + 1)
    }
  }
  let n = 0
  for (const c of counts.values()) if (c >= 2) n++
  return n
}

collisions.sort((a, b) =>
  b[1].size - a[1].size ||
  dupExportCount(b[1]) - dupExportCount(a[1])
)

// Report
console.log(`# Audit C — Stem name collisions across canonical dirs`)
console.log(``)
console.log(`Scanned dirs: src/core/handlers, src/core/services, src/main/services`)
console.log(`Found ${collisions.length} stem collisions.`)
console.log(``)

let triplons = 0
let realDups = 0
const SEPARATOR = '─'.repeat(70)

for (const [stem, dirMap] of collisions) {
  const dirCount = dirMap.size
  const triplon = dirCount === 3
  if (triplon) triplons++

  // Compute exported-name overlap
  const allNames = new Map() // name -> [{label, kind, line, relpath}]
  for (const [label, info] of dirMap) {
    for (const e of info.exports) {
      if (!allNames.has(e.name)) allNames.set(e.name, [])
      allNames.get(e.name).push({ label, ...e, relpath: info.relpath })
    }
  }
  const dupNames = [...allNames.entries()].filter(([_, locs]) => locs.length >= 2)
  if (dupNames.length > 0) realDups++

  // Header
  console.log(SEPARATOR)
  const flag = triplon ? '🔴 TRIPLON' : (dupNames.length > 0 ? '🟠 REAL DUPLICATION' : '🟡 stem-only (no dup symbols)')
  console.log(`## ${stem}.ts  —  ${flag}  (${dirCount} dirs, ${dupNames.length} duplicated exports)`)

  // Show files
  for (const [label, info] of dirMap) {
    console.log(`  ${label}/${stem}.ts  (${info.exports.length} exports)`)
  }
  console.log(``)

  // Show duplicated symbols only (not the full list — keep readable)
  if (dupNames.length > 0) {
    console.log(`  Duplicated exports:`)
    for (const [name, locs] of dupNames) {
      const where = locs.map(l => `${l.label}:${l.line}`).join(', ')
      console.log(`    ${locs[0].kind.padEnd(9)} ${name.padEnd(40)} [${where}]`)
    }
    console.log(``)
  } else {
    // For stem-only collisions, still show what each side exports so we know
    // they're conceptually unrelated
    for (const [label, info] of dirMap) {
      const sample = info.exports.slice(0, 4).map(e => e.name).join(', ') || '(none)'
      console.log(`  ${label}: ${sample}${info.exports.length > 4 ? ', ...' : ''}`)
    }
    console.log(``)
  }
}

console.log(SEPARATOR)
console.log(``)
console.log(`## Summary`)
console.log(`  Total stem collisions:        ${collisions.length}`)
console.log(`  🔴 Triplons (3 dirs):         ${triplons}`)
console.log(`  🟠 Real duplications:         ${realDups}`)
console.log(`  🟡 Stem-only (no shared API): ${collisions.length - realDups}`)
