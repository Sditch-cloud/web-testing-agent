/**
 * Main entry point — Web Testing Agent
 *
 * Wires together the full pipeline:
 *   NL input → compile → validate → expand → execute → report
 */

import { chromium } from 'playwright'
import { TestCaseCompiler } from './orchestrator/TestCaseCompiler.js'
import { DslValidator } from './orchestrator/DslValidator.js'
import { MacroExpander } from './orchestrator/MacroExpander.js'
import { executeTestCase } from './orchestrator/testLoop.js'
import { DslSnapshotStore } from './store/DslSnapshotStore.js'
import { SessionStore } from './store/SessionStore.js'
import type { TestRunState } from './types/Task.js'

// ── Config from environment ───────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o'
const STORAGE_DIR = process.env.STORAGE_DIR ?? './data'
const GLOBAL_TIMEOUT_MS = parseInt(process.env.TEST_EXECUTION_TIMEOUT_MS ?? '120000', 10)
const MAX_RETRIES = parseInt(process.env.MAX_STEP_RETRIES ?? '3', 10)
const COMPILE_MAX_TOKENS = parseInt(process.env.COMPILE_MAX_TOKENS ?? '4096', 10)

// ── Guard: check token budget BEFORE calling OpenAI ───────────────────────────

function checkTokenBudget(maxTokens: number): void {
  if (maxTokens <= 0) {
    throw new Error(`Token budget exhausted: maxTokens=${maxTokens}`)
  }
  if (maxTokens > 8192) {
    console.warn(`[WARN] Compile max_tokens=${maxTokens} is unusually high — capped at 8192`)
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

export type RunOptions = {
  /** Natural language test description */
  nlInput: string
  /** Resume from a previous run ID (interrupt recovery) */
  resumeRunId?: string
  /** Whether to run in headless mode */
  headless?: boolean
}

export async function run(options: RunOptions): Promise<void> {
  const { nlInput, resumeRunId, headless = true } = options

  const dslStore = new DslSnapshotStore(STORAGE_DIR)
  const sessionStore = new SessionStore(STORAGE_DIR)

  // ── Interrupt recovery ────────────────────────────────────────────────────
  let resumeState: TestRunState | undefined
  if (resumeRunId) {
    const saved = await sessionStore.load(resumeRunId)
    if (!saved) {
      console.error(`[ERROR] No session found for run ID: ${resumeRunId}`)
      process.exit(1)
    }
    if (saved.status === 'completed') {
      console.log(`[INFO] Run ${resumeRunId} already completed — nothing to resume`)
      return
    }
    resumeState = saved
    console.log(`[INFO] Resuming run ${resumeRunId} from step ${resumeState.step_cursor}`)
  }

  // ── Compilation (skipped on resume) ───────────────────────────────────────
  let dsl = resumeState?.dsl

  if (!dsl) {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required. Copy .env.example to .env and fill in your key.')
    }

    // Budget guard
    checkTokenBudget(COMPILE_MAX_TOKENS)

    console.log('[INFO] Compiling test case...')
    const compiler = new TestCaseCompiler({
      apiKey: OPENAI_API_KEY,
      model: OPENAI_MODEL,
      maxTokens: COMPILE_MAX_TOKENS,
    })

    const result = await compiler.compile(nlInput)

    if (!result.dsl || result.report.errors.length > 0) {
      console.error('[ERROR] Compilation failed:')
      result.report.errors.forEach(e => console.error(`  - [${e.code}] ${e.message}`))
      process.exit(1)
    }

    console.log(`[INFO] Compiled with confidence=${result.report.confidence.toFixed(2)}, tokens=${result.usage.total_tokens}`)
    if (result.report.warnings.length > 0) {
      result.report.warnings.forEach(w => console.warn(`  [WARN] ${w.message}`))
    }

    // ── Validation ───────────────────────────────────────────────────────────
    const expander = new MacroExpander()
    const { dsl: expandedDsl, expandedCount } = expander.expand(result.dsl)
    if (expandedCount > 0) {
      console.log(`[INFO] Macro expander expanded ${expandedCount} step(s)`)
    }

    const validator = new DslValidator()
    const validation = validator.validate(expandedDsl)
    if (!validation.valid) {
      console.error('[ERROR] DSL validation failed:')
      validation.errors.forEach(e => console.error(`  - [${e.code}] ${e.message}`))
      process.exit(1)
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(w => console.warn(`  [WARN] ${w.message}`))
    }

    dsl = expandedDsl

    // Persist DSL snapshot
    const revision = await dslStore.save(nlInput, dsl)
    console.log(`[INFO] DSL saved (v${revision.version}): ${dsl.id}`)
  }

  // ── Browser execution ─────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless })
  const page = await browser.newPage()

  console.log(`[INFO] Starting test: ${dsl.name} (${dsl.steps.length} steps)`)

  try {
    const generator = executeTestCase({
      dsl,
      page,
      sessionStore,
      maxRetries: MAX_RETRIES,
      globalTimeoutMs: GLOBAL_TIMEOUT_MS,
      screenshotDir: `${STORAGE_DIR}/screenshots`,
      resumeFrom: resumeState,
    })

    // Stream step artifacts
    let report = null
    while (true) {
      const { value, done } = await generator.next()
      if (done) {
        report = value
        break
      }
      const artifact = value
      const icon = artifact.success ? '✅' : artifact.transition === 'skip' ? '⏭️' : '❌'
      console.log(`  ${icon} ${artifact.step_id} (${artifact.tool_name}) — ${artifact.transition} [${artifact.attempt_count} attempt(s)]`)
      if (artifact.error) console.log(`     Error: ${artifact.error}`)
    }

    if (report) {
      console.log('\n' + report.summary)

      // Write JSON report
      const { writeFile, mkdir } = await import('node:fs/promises')
      const reportsDir = `${STORAGE_DIR}/reports`
      await mkdir(reportsDir, { recursive: true })
      const reportPath = `${reportsDir}/${report.run_id}.json`
      await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
      console.log(`\n[INFO] Report saved: ${reportPath}`)
    }
  } finally {
    await browser.close()
  }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const args = process.argv.slice(2)
  const resumeFlag = args.indexOf('--resume')
  const resumeRunId = resumeFlag >= 0 ? args[resumeFlag + 1] : undefined
  const nlInput = args.filter((_, i) => i !== resumeFlag && i !== resumeFlag + 1).join(' ')

  if (!nlInput && !resumeRunId) {
    console.error('Usage: node src/index.js "<nl test description>" [--resume <run_id>]')
    process.exit(1)
  }

  run({ nlInput: nlInput || '', resumeRunId }).catch(err => {
    console.error('[FATAL]', err)
    process.exit(1)
  })
}
