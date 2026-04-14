import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import * as fs from 'fs/promises'
import * as path from 'path'
import { expandTilde } from '../utils/paths'

// ─── Types ──────────────────────────────────────────────────

interface SlashCommand {
  name: string
  description: string
  source: string
}

// ─── Constants ──────────────────────────────────────────────

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Compact conversation history', source: 'builtin' },
  { name: 'clear', description: 'Clear AI context (messages stay visible)', source: 'builtin' },
  { name: 'help', description: 'Show available commands', source: 'builtin' },
]

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/
const DESCRIPTION_RE = /^description:\s*(.+)$/m
const NAME_RE = /^name:\s*(.+)$/m

const MACROS_DIR = expandTilde('~/.agent-desktop/macros')

// ─── Inline utilities ───────────────────────────────────────

function validatePathSafe(filePath: string): string {
  const resolved = path.resolve(filePath)
  const blocked = ['/proc', '/sys', '/dev', '/boot', '/sbin', '/etc']
  for (const prefix of blocked) {
    if (resolved.startsWith(prefix + '/') || resolved === prefix) {
      throw new Error(`Access denied: ${prefix} is a protected directory`)
    }
  }
  return resolved
}

function extractDescription(frontmatter: string): string {
  const lineMatch = frontmatter.match(DESCRIPTION_RE)
  if (lineMatch) {
    const val = lineMatch[1].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      return val.slice(1, -1)
    }
    if (val === '>') {
      const descIdx = frontmatter.indexOf('description:')
      const afterDesc = frontmatter.slice(descIdx)
      const lines = afterDesc.split('\n').slice(1)
      const parts: string[] = []
      for (const line of lines) {
        if (line.match(/^\s+/)) {
          parts.push(line.trim())
        } else {
          break
        }
      }
      return parts.join(' ')
    }
    return val
  }
  return ''
}

async function readFrontmatter(filePath: string): Promise<{ name?: string; description: string }> {
  try {
    const fd = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(2048)
      const { bytesRead } = await fd.read(buf, 0, 2048)
      const head = buf.toString('utf-8', 0, bytesRead)
      const fmMatch = head.match(FRONTMATTER_RE)
      if (fmMatch) {
        const nameMatch = fmMatch[1].match(NAME_RE)
        return {
          name: nameMatch ? nameMatch[1].trim() : undefined,
          description: extractDescription(fmMatch[1]),
        }
      }
    } finally {
      await fd.close()
    }
  } catch {
    // Can't read file
  }
  return { description: '' }
}

async function scanCommandsDir(dir: string, source: 'user' | 'project'): Promise<SlashCommand[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const commands: SlashCommand[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const name = entry.slice(0, -3)
    const filePath = path.join(dir, entry)
    const fm = await readFrontmatter(filePath)
    commands.push({ name, description: fm.description, source })
  }
  return commands
}

interface MacroFile {
  description?: string
  messages: string[]
}

async function scanMacrosDir(): Promise<SlashCommand[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(MACROS_DIR)
  } catch {
    return []
  }

  const macros: SlashCommand[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const name = entry.slice(0, -5)
    try {
      const raw = await fs.readFile(path.join(MACROS_DIR, entry), 'utf-8')
      const parsed = JSON.parse(raw) as MacroFile
      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        macros.push({ name, description: parsed.description || '', source: 'macro' })
      }
    } catch {
      // Invalid JSON or unreadable
    }
  }
  return macros
}

async function loadMacro(name: string): Promise<string[] | null> {
  try {
    const filePath = path.join(MACROS_DIR, `${name}.json`)
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as MacroFile
    if (Array.isArray(parsed.messages) && parsed.messages.every((m) => typeof m === 'string') && parsed.messages.length > 0) {
      return parsed.messages
    }
  } catch {
    // File not found or invalid
  }
  return null
}

async function scanSkillsDir(dir: string): Promise<SlashCommand[]> {
  let entries: import('fs').Dirent[] | string[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const skills: SlashCommand[] = []
  for (const entry of entries) {
    const dirName = typeof entry === 'string' ? entry : entry.name
    const isDir = typeof entry === 'string' ? false : entry.isDirectory()
    if (!isDir) continue

    const skillFile = path.join(dir, dirName, 'SKILL.md')
    const fm = await readFrontmatter(skillFile)
    const name = fm.name || dirName
    skills.push({ name, description: fm.description, source: 'skill' })
  }
  return skills
}

// ─── Handler registration ───────────────────────────────────

export function registerCommandsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('commands:list', async (_event, cwd?: unknown, skillsMode?: unknown) => {
    const results = new Map<string, SlashCommand>()

    for (const cmd of BUILTIN_COMMANDS) {
      results.set(cmd.name, cmd)
    }

    const claudeDir = expandTilde('~/.claude')
    const userCommandsDir = path.join(claudeDir, 'commands')
    const userCommands = await scanCommandsDir(userCommandsDir, 'user')
    for (const cmd of userCommands) {
      results.set(cmd.name, cmd)
    }

    if (cwd && typeof cwd === 'string') {
      try {
        const safeCwd = validatePathSafe(cwd)
        const projectDir = path.join(safeCwd, '.claude', 'commands')
        const projectCommands = await scanCommandsDir(projectDir, 'project')
        for (const cmd of projectCommands) {
          results.set(cmd.name, cmd)
        }
      } catch {
        // Invalid cwd
      }
    }

    if (skillsMode && typeof skillsMode === 'string' && skillsMode !== 'off') {
      const userSkillsDir = path.join(claudeDir, 'skills')
      const userSkills = await scanSkillsDir(userSkillsDir)
      for (const skill of userSkills) {
        results.set(skill.name, skill)
      }

      if ((skillsMode === 'project' || skillsMode === 'local') && cwd && typeof cwd === 'string') {
        try {
          const safeCwd = validatePathSafe(cwd)
          const projectSkillsDir = path.join(safeCwd, '.claude', 'skills')
          const projectSkills = await scanSkillsDir(projectSkillsDir)
          for (const skill of projectSkills) {
            results.set(skill.name, skill)
          }
        } catch {
          // Invalid cwd
        }
      }
    }

    const macros = await scanMacrosDir()
    for (const macro of macros) {
      results.set(macro.name, macro)
    }

    // PI extension commands are skipped in core — they require the PI SDK
    // which depends on Electron paths. They remain Electron-only.

    return Array.from(results.values())
  })

  registrar.handle('macros:load', async (_event, name: unknown) => {
    if (typeof name !== 'string') return null
    return loadMacro(name)
  })
}
