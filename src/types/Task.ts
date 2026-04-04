/**
 * Task and session state types for the Web Testing Agent.
 *
 * Adapted from the claude-code reference: Task.ts TaskStateBase and TaskStatus.
 * Key additions: step_cursor (DSL execution progress) and StepArtifact (evidence).
 */

import type { TestCaseDsl } from './TestDsl.js'

// ── Task status ───────────────────────────────────────────────────────────────

export type TestRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

export function isTerminalStatus(status: TestRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

// ── Step transition (per-step finite state machine) ───────────────────────────

/** The outcome of executing a single DSL step. */
export type StepTransition =
  | 'success'    // Step completed successfully
  | 'retry'      // Step failed but retry budget remains
  | 'skip'       // Step failed and is marked skippable
  | 'fail_fast'  // Step failed and should abort the test

// ── Step artifact (structured evidence from tool execution) ──────────────────

export type StepArtifact = {
  step_id: string
  /** The tool that produced this artifact */
  tool_name: string
  /** When the step started executing */
  started_at: string
  /** When the step finished (success or failure) */
  finished_at: string
  /** Whether the step succeeded */
  success: boolean
  /** Tool-specific evidence (URL, selector, screenshot path, etc.) */
  evidence: Record<string, unknown>
  /** Error message if the step failed */
  error?: string
  /** How many attempts were made (1 = no retry) */
  attempt_count: number
  /** The final transition for this step */
  transition: StepTransition
}

// ── Test run state (mutable during execution) ─────────────────────────────────

/**
 * Mutable state carried across the test loop.
 * Persisted to SessionStore after each step for interrupt recovery.
 */
export type TestRunState = {
  /** Unique run ID (e.g. "run_abc123") */
  id: string
  /** Current run status */
  status: TestRunStatus
  /** Index of the currently executing step (0-based) */
  step_cursor: number
  /** Retry count for the current step */
  retry_count: number
  /** The compiled DSL being executed */
  dsl: TestCaseDsl
  /** Collected artifacts from executed steps */
  artifacts: StepArtifact[]
  /** ISO timestamp when the run started */
  started_at: string
  /** ISO timestamp when the run ended (set on terminal status) */
  ended_at?: string
  /** Reason for failure if status is 'failed' or 'killed' */
  failure_reason?: string
}

// ── Test report (final output) ────────────────────────────────────────────────

export type TestReport = {
  run_id: string
  test_name: string
  status: TestRunStatus
  /** Total steps in the DSL */
  total_steps: number
  /** Steps that reached 'success' */
  passed_steps: number
  /** Steps that were skipped */
  skipped_steps: number
  /** Steps that failed */
  failed_steps: number
  /** All step artifacts with evidence */
  artifacts: StepArtifact[]
  /** Original compile report for traceability */
  compile_report: import('./TestDsl.js').CompileReport
  /** ISO timestamp of run start */
  started_at: string
  /** ISO timestamp of run end */
  ended_at: string
  /** Total execution time in milliseconds */
  duration_ms: number
  /** Markdown summary of the test run */
  summary: string
}

// ── Utility: generate a short unique ID ───────────────────────────────────────

export function generateRunId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
  let id = 'run_'
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}
