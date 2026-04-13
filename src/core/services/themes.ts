import { join } from 'path'
import fs from 'fs/promises'
import type { ThemeFile } from '../types'

const BUILTIN_FILENAMES = ['default-dark.css', 'default-light.css']

const DEFAULT_DARK_CSS = `/* Agent Desktop — Default Dark Theme */
:root {
  --color-bg: #1a1a2e;
  --color-surface: #16213e;
  --color-deep: #0f3460;
  --color-primary: #e94560;
  --color-text: #eaeaea;
  --color-text-muted: #a0a0a0;
  --color-accent: #533483;
  --color-success: #00d26a;
  --color-error: #ff4757;
  --color-warning: #ffc107;
  --color-tool: #00bcd4;
  --color-text-contrast: #fff;
  --color-overlay: rgba(0, 0, 0, 0.5);
}
`

const DEFAULT_LIGHT_CSS = `/* Agent Desktop — Default Light Theme */
:root {
  --color-bg: #ffffff;
  --color-surface: #ffffff;
  --color-deep: #e5e7eb;
  --color-primary: #6366f1;
  --color-text: #1f2937;
  --color-text-muted: #6b7280;
  --color-accent: #8b5cf6;
  --color-success: #10b981;
  --color-error: #ef4444;
  --color-warning: #f59e0b;
  --color-tool: #0891b2;
  --color-text-contrast: #fff;
  --color-overlay: rgba(0, 0, 0, 0.3);
}
`

const CHEATSHEET_MD = `# Agent Desktop — Theme Cheatsheet

## CSS Custom Properties

Every theme must define these variables inside \`:root { }\`:

| Variable               | Role                                      |
|------------------------|--------------------------------------------|
| \`--color-bg\`           | App background                             |
| \`--color-surface\`      | Cards, panels, inputs                      |
| \`--color-deep\`         | Sidebar items, secondary surfaces          |
| \`--color-primary\`      | Buttons, links, active indicators          |
| \`--color-text\`         | Main text                                  |
| \`--color-text-muted\`   | Secondary text, placeholders               |
| \`--color-text-contrast\`| Text on colored backgrounds (buttons)      |
| \`--color-accent\`       | Accents, SSE badges                        |
| \`--color-success\`      | Success states                             |
| \`--color-error\`        | Errors, delete buttons                     |
| \`--color-warning\`      | Warnings, connecting states                |
| \`--color-tool\`         | Tool/info accents                          |
| \`--color-overlay\`      | Modal/drag overlay background              |

## Creating a Theme

1. Create a \`.css\` file in this directory (\`~/.agent-desktop/themes/\`)
2. Define all \`--color-*\` variables inside \`:root { }\`
3. Reload themes in Settings > Appearance
4. Click your theme to activate it
`

function filenameToName(filename: string): string {
  return filename
    .replace(/\.css$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function validateFilename(filename: string): void {
  if (typeof filename !== 'string') throw new Error('Filename must be a string')
  if (!filename.endsWith('.css')) throw new Error('Filename must end in .css')
  if (filename.length > 200) throw new Error('Filename exceeds 200 characters')
  if (/[/\\]/.test(filename)) throw new Error('Filename must not contain path separators')
  if (filename.includes('..')) throw new Error('Filename must not contain ..')
}

export class ThemesService {
  constructor(private themesDir: string) {}

  getDir(): string { return this.themesDir }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.themesDir, { recursive: true })
    for (const [filename, content] of [
      ['default-dark.css', DEFAULT_DARK_CSS],
      ['default-light.css', DEFAULT_LIGHT_CSS],
    ] as const) {
      const filePath = join(this.themesDir, filename)
      try { await fs.access(filePath) } catch { await fs.writeFile(filePath, content, 'utf-8') }
    }
    // Seed cheatsheet if absent
    const cheatsheetPath = join(this.themesDir, 'cheatsheet.md')
    try { await fs.access(cheatsheetPath) } catch { await fs.writeFile(cheatsheetPath, CHEATSHEET_MD, 'utf-8') }
  }

  async list(): Promise<ThemeFile[]> {
    const entries = await fs.readdir(this.themesDir)
    const cssFiles = entries.filter((f) => f.endsWith('.css')).sort()
    return Promise.all(cssFiles.map((f) => this.read(f)))
  }

  async read(filename: string): Promise<ThemeFile> {
    validateFilename(filename)
    const css = await fs.readFile(join(this.themesDir, filename), 'utf-8')
    return { filename, name: filenameToName(filename), isBuiltin: BUILTIN_FILENAMES.includes(filename), css }
  }

  async create(filename: string, css: string): Promise<ThemeFile> {
    validateFilename(filename)
    if (typeof css !== 'string') throw new Error('CSS content must be a string')
    const filePath = join(this.themesDir, filename)
    try { await fs.access(filePath); throw new Error(`Theme "${filename}" already exists`) }
    catch (err) { if ((err as Error).message.includes('already exists')) throw err }
    await fs.writeFile(filePath, css, 'utf-8')
    return this.read(filename)
  }

  async save(filename: string, css: string): Promise<void> {
    validateFilename(filename)
    if (typeof css !== 'string') throw new Error('CSS content must be a string')
    if (BUILTIN_FILENAMES.includes(filename)) throw new Error('Cannot modify built-in themes')
    await fs.writeFile(join(this.themesDir, filename), css, 'utf-8')
  }

  async delete(filename: string): Promise<void> {
    validateFilename(filename)
    if (BUILTIN_FILENAMES.includes(filename)) throw new Error('Cannot delete built-in themes')
    await fs.unlink(join(this.themesDir, filename))
  }
}
