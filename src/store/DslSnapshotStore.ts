/**
 * DslSnapshotStore — versioned persistence for compiled test DSLs.
 *
 * Each test case has a directory under STORAGE_DIR/dsl/<test_id>/
 * containing:
 *   - nl_input.txt       — the original natural language input
 *   - dsl_<timestamp>.json — each compiled version of the DSL
 *   - revision_log.jsonl — append-only revision history
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { TestCaseDsl } from '../types/TestDsl.js'

export type DslRevisionEntry = {
  version: number
  compiled_at: string
  snapshot_file: string
  compile_confidence: number
  note?: string
}

export type DslSnapshot = {
  nl_input: string
  dsl: TestCaseDsl
  revision: DslRevisionEntry
}

export class DslSnapshotStore {
  private readonly baseDir: string

  constructor(storageDir: string) {
    this.baseDir = path.join(storageDir, 'dsl')
  }

  private testDir(testId: string): string {
    return path.join(this.baseDir, testId)
  }

  private async ensureTestDir(testId: string): Promise<string> {
    const dir = this.testDir(testId)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  /** Save a compiled DSL snapshot. Returns the revision entry. */
  async save(nlInput: string, dsl: TestCaseDsl): Promise<DslRevisionEntry> {
    const dir = await this.ensureTestDir(dsl.id)

    // Write the original NL input (only once — first version wins)
    const nlFile = path.join(dir, 'nl_input.txt')
    try {
      await fs.access(nlFile)
    } catch {
      await fs.writeFile(nlFile, nlInput, 'utf8')
    }

    // Determine version number from existing revision log
    const revisionLog = path.join(dir, 'revision_log.jsonl')
    let version = 1
    try {
      const content = await fs.readFile(revisionLog, 'utf8')
      const lines = content.trim().split('\n').filter(Boolean)
      version = lines.length + 1
    } catch {
      // No log yet — first version
    }

    // Write DSL snapshot file
    const timestamp = dsl.compile_report.compiled_at.replace(/[:.]/g, '-')
    const snapshotFile = `dsl_${timestamp}.json`
    await fs.writeFile(path.join(dir, snapshotFile), JSON.stringify(dsl, null, 2), 'utf8')

    const entry: DslRevisionEntry = {
      version,
      compiled_at: dsl.compile_report.compiled_at,
      snapshot_file: snapshotFile,
      compile_confidence: dsl.compile_report.confidence,
    }

    // Append to revision log
    await fs.appendFile(revisionLog, JSON.stringify(entry) + '\n', 'utf8')

    return entry
  }

  /** Load the latest DSL snapshot for a test case. */
  async loadLatest(testId: string): Promise<DslSnapshot | null> {
    const dir = this.testDir(testId)
    const revisionLog = path.join(dir, 'revision_log.jsonl')

    let latestEntry: DslRevisionEntry | null = null
    try {
      const content = await fs.readFile(revisionLog, 'utf8')
      const lines = content.trim().split('\n').filter(Boolean)
      if (lines.length === 0) return null
      latestEntry = JSON.parse(lines[lines.length - 1]!) as DslRevisionEntry
    } catch {
      return null
    }

    const [dslContent, nlInput] = await Promise.all([
      fs.readFile(path.join(dir, latestEntry.snapshot_file), 'utf8'),
      fs.readFile(path.join(dir, 'nl_input.txt'), 'utf8').catch(() => ''),
    ])

    return {
      nl_input: nlInput,
      dsl: JSON.parse(dslContent) as TestCaseDsl,
      revision: latestEntry,
    }
  }

  /** List all revision entries for a test case. */
  async listRevisions(testId: string): Promise<DslRevisionEntry[]> {
    const revisionLog = path.join(this.testDir(testId), 'revision_log.jsonl')
    try {
      const content = await fs.readFile(revisionLog, 'utf8')
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as DslRevisionEntry)
    } catch {
      return []
    }
  }
}
