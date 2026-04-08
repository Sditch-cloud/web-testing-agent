import { access, readFile } from 'node:fs/promises'

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function resolveNlInput(
  nlInput: string,
  caseFilePath?: string,
): Promise<string> {
  const trimmedNl = nlInput.trim()
  const candidateFile = caseFilePath ?? (trimmedNl.toLowerCase().endsWith('.md') ? trimmedNl : undefined)

  if (!candidateFile) return nlInput

  if (!(await exists(candidateFile))) {
    throw new Error(`Markdown test case file not found: ${candidateFile}`)
  }

  const content = await readFile(candidateFile, 'utf8')
  const normalized = content.trim()
  if (!normalized) {
    throw new Error(`Markdown test case file is empty: ${candidateFile}`)
  }

  console.log(`[INFO] Loaded test case from markdown: ${candidateFile}`)
  return normalized
}
