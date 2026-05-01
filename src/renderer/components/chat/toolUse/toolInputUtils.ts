/** Truncate a file path to the last N directory segments + filename */
export function truncatePath(filePath: string, segments = 3): string {
  const parts = filePath.split('/')
  if (parts.length <= segments + 1) return filePath
  return parts.slice(-(segments + 1)).join('/')
}

/** Check if tool is an edit tool (Claude SDK "Edit" or PI "edit") */
export function isEditTool(name: string): boolean {
  return name.toLowerCase() === 'edit'
}

/** Get the old/new strings from an edit tool, handling both SDK conventions */
export function getEditDiffStrings(input: Record<string, unknown>): { oldStr: string; newStr: string } | null {
  // Claude SDK: old_str / new_str — PI SDK: oldText / newText
  const oldStr = (input.old_str ?? input.oldText) as string | undefined
  const newStr = (input.new_str ?? input.newText) as string | undefined
  if (oldStr != null && newStr != null) return { oldStr, newStr }
  return null
}

/** Get file path from tool input (Claude SDK: file_path, PI SDK: path) */
export function getFilePath(input: Record<string, unknown>): string | null {
  return (input.file_path ?? input.path) as string | null
}
