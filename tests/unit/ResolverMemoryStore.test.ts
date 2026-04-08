import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ResolverMemoryStore } from '../../src/store/ResolverMemoryStore.js'

const cleanupTargets: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupTargets.splice(0).map(async dir => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('ResolverMemoryStore', () => {
  it('stores and returns ranked memory candidates', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolver-memory-'))
    cleanupTargets.push(tempDir)

    const store = new ResolverMemoryStore(tempDir)
    await store.recordSuccess('username', 'input', { id: 'c1', strategy: 'label', value: 'Username', score: 0.8 })
    await store.recordSuccess('username', 'input', { id: 'c1', strategy: 'label', value: 'Username', score: 0.8 })
    await store.recordSuccess('username', 'input', { id: 'c2', strategy: 'text', value: 'Email', score: 0.7 })

    const candidates = await store.getCandidates('username', 'input')
    expect(candidates.length).toBeGreaterThanOrEqual(2)
    expect(candidates[0]!.strategy).toBe('memory')
    expect(candidates[0]!.value).toBe('Username')
  })
})
