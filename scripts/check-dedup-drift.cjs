#!/usr/bin/env node
/**
 * Compare current dedup metrics to the committed baseline.
 *
 * Run after a refactor to verify clone counts moved in the right direction.
 * Run in CI to catch regressions (unexpected new clones introduced).
 *
 * Tolerance: by default, allows clusters/instances to MATCH or DECREASE vs baseline.
 * Any increase fails with non-zero exit (suitable for CI gate).
 *
 * Update the baseline (after intentional improvement) with:
 *   node scripts/check-dedup-drift.cjs --update
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const BASELINE = path.join(__dirname, '.dedup-baseline.json')
const UPDATE = process.argv.includes('--update')

function getCurrent() {
  const out = execSync('node ' + path.join(__dirname, 'dedup-analyzer.cjs'), {
    encoding: 'utf-8',
    cwd: ROOT,
  })
  // Parse the analyzer's stats lines
  const m = (regex) => (out.match(regex) || [, '0'])[1]
  return {
    fnClusters: parseInt(m(/^Found (\d+) clusters of duplicated functions/m), 10),
    sqlClusters: parseInt(m(/^Found (\d+) clusters of duplicated SQL/m), 10),
    fnInstances: parseInt(m(/^Function instances in clones: (\d+) of/m), 10),
    fnTotal: parseInt(m(/^Function instances in clones: \d+ of (\d+)/m), 10),
    sqlInstances: parseInt(m(/^SQL instances in clones: (\d+) of/m), 10),
    sqlTotal: parseInt(m(/^SQL instances in clones: \d+ of (\d+)/m), 10),
    timestamp: new Date().toISOString(),
  }
}

function pct(num, denom) {
  return denom > 0 ? ((num / denom) * 100).toFixed(1) : '0.0'
}

const current = getCurrent()

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n')
  console.log(`✓ Baseline updated: ${BASELINE}`)
  console.log(`  Functions: ${current.fnInstances}/${current.fnTotal} (${pct(current.fnInstances, current.fnTotal)}%) in ${current.fnClusters} clusters`)
  console.log(`  SQL:       ${current.sqlInstances}/${current.sqlTotal} (${pct(current.sqlInstances, current.sqlTotal)}%) in ${current.sqlClusters} clusters`)
  process.exit(0)
}

if (!fs.existsSync(BASELINE)) {
  console.error(`No baseline at ${BASELINE}. Run with --update to seed it.`)
  process.exit(2)
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'))

const checks = [
  { name: 'fnClusters', label: 'Function clusters' },
  { name: 'fnInstances', label: 'Function clone instances' },
  { name: 'sqlClusters', label: 'SQL clusters' },
  { name: 'sqlInstances', label: 'SQL clone instances' },
]

let regressed = false
console.log(`Dedup drift report (current vs baseline):\n`)
for (const { name, label } of checks) {
  const cur = current[name]
  const base = baseline[name]
  const delta = cur - base
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '='
  const flag = delta > 0 ? ' ⚠ REGRESSED' : ''
  console.log(`  ${label.padEnd(28)} ${cur.toString().padStart(4)}  (baseline ${base}, ${arrow}${delta >= 0 ? '+' : ''}${delta})${flag}`)
  if (delta > 0) regressed = true
}
console.log()
console.log(`  Functions clone ratio: ${pct(current.fnInstances, current.fnTotal)}% (baseline ${pct(baseline.fnInstances, baseline.fnTotal)}%)`)
console.log(`  SQL clone ratio:       ${pct(current.sqlInstances, current.sqlTotal)}% (baseline ${pct(baseline.sqlInstances, baseline.sqlTotal)}%)`)
console.log()

if (regressed) {
  console.error(`✗ Dedup regressed. Either fix the introduced clones, or run`)
  console.error(`  \`node scripts/check-dedup-drift.cjs --update\` if the regression`)
  console.error(`  is justified (e.g. necessary cross-platform duplication).`)
  process.exit(1)
}

console.log(`✓ Dedup metrics within or below baseline.`)
process.exit(0)
