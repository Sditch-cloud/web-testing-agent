/**
 * SessionStore — persists TestRunState snapshots for interrupt recovery.
 *
 * Each test run is stored as a JSON file under STORAGE_DIR/sessions/<run_id>.json.
 * After each step the executor writes a snapshot, enabling recovery on restart.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { TestRunState } from '../types/Task.js'

export class SessionStore {
  private readonly baseDir: string

  constructor(storageDir: string) {
    this.baseDir = path.join(storageDir, 'sessions')
  }

  private sessionFile(runId: string): string {
    return path.join(this.baseDir, `${runId}.json`)
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true })
  }

  /** Persist the current TestRunState to disk. Called after each step. */
  async save(state: TestRunState): Promise<void> {
    await this.ensureDir()
    await fs.writeFile(this.sessionFile(state.id), JSON.stringify(state, null, 2), 'utf8')
  }

  /** Load a previously saved TestRunState by run ID. Returns null if not found. */
  async load(runId: string): Promise<TestRunState | null> {
    try {
      const content = await fs.readFile(this.sessionFile(runId), 'utf8')
      return JSON.parse(content) as TestRunState
    } catch {
      return null
    }
  }

  /** List all stored run IDs (most recent first by file mtime). */
  async listRunIds(): Promise<string[]> {
    try {
      await this.ensureDir()
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true })
      const jsonFiles = entries
        .filter(e => e.isFile() && e.name.endsWith('.json'))
        .map(e => e.name.replace(/\.json$/, ''))
      return jsonFiles.reverse()
    } catch {
      return []
    }
  }

  /** Delete a stored session (e.g. after successful completion). */
  async delete(runId: string): Promise<void> {
    try {
      await fs.unlink(this.sessionFile(runId))
    } catch {
      // Ignore if already deleted
    }
  }
}
