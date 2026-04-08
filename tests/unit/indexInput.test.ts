import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveNlInput } from '../../src/orchestrator/NlInputLoader.js'

const cleanupTargets: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupTargets.splice(0).map(async dir => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('resolveNlInput', () => {
  it('returns plain NL input when no markdown path provided', async () => {
    const text = 'open https://example.com and take screenshot'
    const resolved = await resolveNlInput(text)
    expect(resolved).toBe(text)
  })

  it('loads content from markdown file with --case path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nl-md-case-'))
    cleanupTargets.push(tempDir)

    const filePath = path.join(tempDir, 'login.md')
    await fs.writeFile(filePath, '# 登录\n\n打开首页并登录', 'utf8')

    const resolved = await resolveNlInput('', filePath)
    expect(resolved).toContain('打开首页并登录')
  })

  it('loads content when nlInput is markdown path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nl-md-auto-'))
    cleanupTargets.push(tempDir)

    const filePath = path.join(tempDir, 'case.md')
    await fs.writeFile(filePath, '测试内容', 'utf8')

    const resolved = await resolveNlInput(filePath)
    expect(resolved).toBe('测试内容')
  })
})
