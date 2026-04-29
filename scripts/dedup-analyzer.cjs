#!/usr/bin/env node
/**
 * Duplication audit using TypeScript Compiler API.
 *
 *   A) Function-body clones (Type-1 exact + Type-2 rename-aware)
 *   B) SQL prepare()/all()/get()/run() string clone clusters
 *
 * Walks `src/` (excludes node_modules, out, dist, *.d.ts, test files).
 * Outputs grouped duplicates with file:line locations.
 *
 * Usage:  node scripts/dedup-analyzer.cjs [--include-tests]
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const INCLUDE_TESTS = process.argv.includes('--include-tests')

// ─── 1. File walking ───────────────────────────────────────────────

const SKIP_DIR_NAMES = new Set([
  'node_modules', 'out', 'dist', 'dist-electron', 'dist-headless',
  'release', 'build', '.git', 'graphify-out', '.claude',
])

function* walkTsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkTsFiles(full)
    } else if (entry.isFile()) {
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      if (entry.name.endsWith('.d.ts')) continue
      if (!INCLUDE_TESTS && /\.(test|spec|integration\.test)\.tsx?$/.test(entry.name)) continue
      yield full
    }
  }
}

// ─── 2. Type-2 normalization ────────────────────────────────────────
//
// Goal: identical-after-renaming bodies hash the same.
//
// Strategy:
//   - Walk the AST of the body
//   - For every Identifier, replace its text with a positional placeholder
//     scoped to the function (parameters → P0, P1; locals → V0, V1; ...)
//   - Strings, numerics, keywords, operators, punctuation kept verbatim
//   - Preserve structural shape (parens, braces, semis)
//
// This catches:
//   function f(a) { return a + 1 }  ===  function g(b) { return b + 1 }
//
// But not:
//   function f(a) { return a + 1 }  vs  function f(a) { return a - 1 }   (good — different op)
//   function f(a) { let x = 0; return x + a }  vs  function g(a) { let y = 0; return y + a }  (good — same shape, different names)

function normalizeBody(node, sourceFile) {
  // Map identifier text → positional placeholder, scoped to this function.
  const idMap = new Map()
  let idCounter = 0
  const getPlaceholder = (text) => {
    if (!idMap.has(text)) idMap.set(text, `_id${idCounter++}`)
    return idMap.get(text)
  }

  // Identifiers we never rename — they reference the cross-module surface.
  // If they were renamed, we'd treat `db.prepare()` and `foo.prepare()` as the
  // same shape, which would be too permissive.
  const KEEP = new Set([
    // built-in globals / methods of well-known shapes
    'undefined', 'null', 'true', 'false',
    'this', 'super', 'NaN', 'Infinity',
    'Promise', 'Array', 'Object', 'Map', 'Set', 'Date', 'JSON',
    'Number', 'String', 'Boolean', 'Symbol', 'RegExp', 'Error',
    'console', 'process', 'globalThis',
    'await', 'yield', 'async',
  ])

  const parts = []

  function emit(text) { parts.push(text) }

  function visit(n) {
    // Skip JSDoc / comments — TypeScript exposes them as triviaWidth on the next token.
    // We don't emit them.

    // Identifier handling
    if (ts.isIdentifier(n)) {
      const t = n.text
      if (KEEP.has(t)) {
        emit(t)
      } else {
        emit(getPlaceholder(t))
      }
      return
    }

    // String literals → keep with NORM marker so two functions doing identical SQL
    // still match exactly, but a function with a different SQL doesn't.
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      emit(JSON.stringify(n.text))
      return
    }

    // Numeric literals → keep verbatim
    if (ts.isNumericLiteral(n)) { emit(n.text); return }

    // Template expressions — descend
    if (ts.isTemplateExpression(n)) {
      emit('`')
      emit(JSON.stringify(n.head.text))
      for (const span of n.templateSpans) {
        emit('${')
        visit(span.expression)
        emit('}')
        emit(JSON.stringify(span.literal.text))
      }
      emit('`')
      return
    }

    // For all other node kinds: emit a token shape based on SyntaxKind, then
    // visit children. This keeps structural information (operators, keywords,
    // delimiters) without depending on whitespace.
    const kind = ts.SyntaxKind[n.kind]
    emit(`<${kind}`)
    n.forEachChild(visit)
    emit(`>`)
  }

  visit(node)
  return parts.join('')
}

// ─── 3. Function & SQL extraction ───────────────────────────────────

function getLineCol(sourceFile, pos) {
  const lc = sourceFile.getLineAndCharacterOfPosition(pos)
  return { line: lc.line + 1, col: lc.character + 1 }
}

function summarizeSignature(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    const name = node.name ? node.name.getText() : '<anonymous>'
    const params = node.parameters.map(p => p.name.getText()).join(', ')
    return `${name}(${params})`
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const params = node.parameters.map(p => p.name.getText()).join(', ')
    return `<arrow|fnExpr>(${params})`
  }
  return '<unknown>'
}

const MIN_BODY_BYTES = 80   // ignore tiny one-liners
const MIN_NORMALIZED = 60   // also gate on normalized representation

function extractFunctions(sourceFile, filePath) {
  const out = []
  function visit(node) {
    let body = null
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
         || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
         || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node)
         || ts.isSetAccessorDeclaration(node))
        && node.body) {
      body = node.body
    }
    if (body) {
      const bodyText = body.getText(sourceFile)
      if (bodyText.length >= MIN_BODY_BYTES) {
        const normalized = normalizeBody(body, sourceFile)
        if (normalized.length >= MIN_NORMALIZED) {
          const { line, col } = getLineCol(sourceFile, node.getStart(sourceFile))
          out.push({
            file: path.relative(ROOT, filePath),
            line,
            col,
            sig: summarizeSignature(node),
            bodyText,
            normalized,
            hash: crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16),
            bytes: bodyText.length,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return out
}

// ─── 4. SQL extraction ──────────────────────────────────────────────
//
// Find CallExpressions of shape `<expr>.prepare(<string>)` and capture the
// string. Also captures direct string args to `.exec(...)` since that's also
// SQL.

const SQL_METHODS = new Set(['prepare', 'exec'])

function normalizeSql(s) {
  return s
    .replace(/--[^\n]*/g, ' ')          // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // block comments
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function extractSqlCalls(sourceFile, filePath) {
  const out = []
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text
      if (SQL_METHODS.has(methodName) && node.arguments.length >= 1) {
        const arg = node.arguments[0]
        let raw = null
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          raw = arg.text
        } else if (ts.isTemplateExpression(arg)) {
          // Approximate: head + ${...} + tail, with placeholder for spans
          let s = arg.head.text
          for (const span of arg.templateSpans) {
            s += '?'  // treat dynamic interpolation as a parameter slot
            s += span.literal.text
          }
          raw = s
        }
        if (raw) {
          const { line, col } = getLineCol(sourceFile, node.getStart(sourceFile))
          const norm = normalizeSql(raw)
          // Only flag SQL-shaped strings (must contain a SQL keyword)
          if (/\b(select|insert|update|delete|create|drop|alter|pragma|with)\b/i.test(norm)) {
            out.push({
              file: path.relative(ROOT, filePath),
              line, col,
              method: methodName,
              raw,
              normalized: norm,
              hash: crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16),
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return out
}

// ─── 5. Run ─────────────────────────────────────────────────────────

const allFunctions = []
const allSql = []
let fileCount = 0

for (const filePath of walkTsFiles(SRC)) {
  fileCount++
  const sourceText = fs.readFileSync(filePath, 'utf-8')
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  for (const f of extractFunctions(sf, filePath)) allFunctions.push(f)
  for (const q of extractSqlCalls(sf, filePath)) allSql.push(q)
}

// ─── 6. Cluster by hash ─────────────────────────────────────────────

function clusterByHash(items) {
  const map = new Map()
  for (const it of items) {
    if (!map.has(it.hash)) map.set(it.hash, [])
    map.get(it.hash).push(it)
  }
  return [...map.values()].filter(g => g.length > 1)
}

const fnClusters = clusterByHash(allFunctions)
const sqlClusters = clusterByHash(allSql)

// Sort largest-first, then by body size (worst offenders first)
fnClusters.sort((a, b) => b.length - a.length || (b[0].bytes || 0) - (a[0].bytes || 0))
sqlClusters.sort((a, b) => b.length - a.length || b[0].normalized.length - a[0].normalized.length)

// ─── 7. Report ──────────────────────────────────────────────────────

console.log(`# Duplication audit (TypeScript AST)`)
console.log(``)
console.log(`Scanned ${fileCount} files (${INCLUDE_TESTS ? 'including' : 'excluding'} tests).`)
console.log(`Extracted ${allFunctions.length} functions/methods, ${allSql.length} SQL calls.`)
console.log(``)
console.log(`## A — Function clones (Type-1 exact + Type-2 rename-aware)`)
console.log(``)
console.log(`Found ${fnClusters.length} clusters of duplicated functions.`)
console.log(``)
const TOP_CLUSTERS = 30
fnClusters.slice(0, TOP_CLUSTERS).forEach((g, i) => {
  console.log(`### Cluster ${i + 1} — ${g.length} copies, ~${g[0].bytes}B body`)
  for (const inst of g) {
    console.log(`  ${inst.file}:${inst.line}  ${inst.sig}`)
  }
  // First 3 lines of one body to identify the pattern
  const preview = g[0].bodyText.split('\n').slice(0, 3).map(l => '    ' + l).join('\n')
  console.log(preview)
  console.log(``)
})
if (fnClusters.length > TOP_CLUSTERS) {
  console.log(`... and ${fnClusters.length - TOP_CLUSTERS} smaller clusters.`)
  console.log(``)
}

console.log(`## B — SQL query clones`)
console.log(``)
console.log(`Found ${sqlClusters.length} clusters of duplicated SQL queries.`)
console.log(``)
sqlClusters.slice(0, 25).forEach((g, i) => {
  const sample = g[0].normalized.length > 140 ? g[0].normalized.slice(0, 137) + '...' : g[0].normalized
  console.log(`### SQL Cluster ${i + 1} — ${g.length} copies`)
  console.log(`    ${sample}`)
  for (const inst of g) {
    console.log(`  ${inst.file}:${inst.line}  (.${inst.method})`)
  }
  console.log(``)
})
if (sqlClusters.length > 25) {
  console.log(`... and ${sqlClusters.length - 25} smaller clusters.`)
}

// ─── 8. Stats ───────────────────────────────────────────────────────

const totalDuplicateFns = fnClusters.reduce((s, g) => s + g.length, 0)
const totalDuplicateSql = sqlClusters.reduce((s, g) => s + g.length, 0)
console.log(``)
console.log(`## Stats`)
console.log(`Function instances in clones: ${totalDuplicateFns} of ${allFunctions.length} (${(100*totalDuplicateFns/allFunctions.length).toFixed(1)}%)`)
console.log(`SQL instances in clones: ${totalDuplicateSql} of ${allSql.length} (${(100*totalDuplicateSql/allSql.length).toFixed(1)}%)`)
