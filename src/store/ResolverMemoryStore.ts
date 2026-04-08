import fs from 'node:fs/promises'
import path from 'node:path'
import type { ActionType } from '../types/TestDsl.js'
import type { Candidate, ResolverMemory } from '../resolver/types.js'

type StoredCandidate = Candidate & {
  success_count: number
  last_success_at: string
}

type BucketFile = {
  target_key: string
  action: ActionType
  candidates: StoredCandidate[]
}

function normalizeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
}

export class ResolverMemoryStore implements ResolverMemory {
  private readonly rootDir: string

  constructor(storageDir: string) {
    this.rootDir = path.join(storageDir, 'resolver-memory')
  }

  async getCandidates(targetKey: string, action: ActionType): Promise<Candidate[]> {
    const bucket = await this.readBucket(targetKey, action)
    if (!bucket) return []

    return bucket.candidates
      .sort((a, b) => {
        if (b.success_count !== a.success_count) return b.success_count - a.success_count
        return new Date(b.last_success_at).getTime() - new Date(a.last_success_at).getTime()
      })
      .map(candidate => ({
        id: candidate.id,
        strategy: 'memory',
        value: candidate.value,
        score: Math.min(0.99, 0.9 + candidate.success_count * 0.01),
      }))
  }

  async recordSuccess(targetKey: string, action: ActionType, candidate: Candidate): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true })

    const existing = (await this.readBucket(targetKey, action)) ?? {
      target_key: targetKey,
      action,
      candidates: [],
    }

    const now = new Date().toISOString()
    const found = existing.candidates.find(item => item.value === candidate.value)

    if (found) {
      found.success_count += 1
      found.last_success_at = now
      found.score = candidate.score
      found.strategy = candidate.strategy
      found.id = candidate.id
    } else {
      existing.candidates.push({
        ...candidate,
        success_count: 1,
        last_success_at: now,
      })
    }

    const filePath = this.bucketPath(targetKey, action)
    await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf8')
  }

  private bucketPath(targetKey: string, action: ActionType): string {
    return path.join(this.rootDir, `${normalizeFileName(action)}__${normalizeFileName(targetKey)}.json`)
  }

  private async readBucket(targetKey: string, action: ActionType): Promise<BucketFile | null> {
    try {
      const filePath = this.bucketPath(targetKey, action)
      const raw = await fs.readFile(filePath, 'utf8')
      return JSON.parse(raw) as BucketFile
    } catch {
      return null
    }
  }
}
