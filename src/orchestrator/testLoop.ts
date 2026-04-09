/**
 * testLoop — bounded state machine for executing a TestCaseDsl.
 *
 * Adapted from the claude-code reference queryLoop pattern:
 * - Reference: infinite while(true) + LLM streaming + early returns
 * - This: bounded for-loop over DSL steps + finite transitions (success/retry/skip/fail_fast)
 *
 * Key design decisions (from reference analysis):
 * 1. Mutable State object updated each iteration (same as reference's `let state: State`)
 * 2. Transition metadata tracked per step (same as reference's `transition: Continue | undefined`)
 * 3. AbortController for interrupt support (same as reference's abort handling)
 * 4. Session snapshot after each step (replaces reference's transcript streaming)
 * 5. Local retry sub-loop per step — never rewinds outer loop by more than 1 step
 */

import type { Page } from 'playwright'
import { BrowserToolExecutor } from '../executor/BrowserToolExecutor.js'
import type { ElementResolver, ResolverMemory } from '../resolver/types.js'
import { SessionStore } from '../store/SessionStore.js'
import type { TestCaseDsl } from '../types/TestDsl.js'
import {
  type TestRunState,
  type TestReport,
  type StepArtifact,
  type StepTransition,
  generateRunId,
} from '../types/Task.js'

// ── Loop params ───────────────────────────────────────────────────────────────

export type TestLoopParams = {
  dsl: TestCaseDsl
  page: Page
  sessionStore: SessionStore
  /** Max retries per step (default: 3) */
  maxRetries?: number
  /** Global timeout for the entire test case in ms (default: 120_000) */
  globalTimeoutMs?: number
  /** Directory for screenshots */
  screenshotDir?: string
  /** Resume from a partially executed state (interrupt recovery) */
  resumeFrom?: TestRunState
  /** Semantic resolver implementation */
  resolver?: ElementResolver
  /** Resolver self-healing memory implementation */
  resolverMemory?: ResolverMemory
}

// ── Loop state ────────────────────────────────────────────────────────────────

type LoopState = {
  runId: string
  stepCursor: number
  retryCount: number
  artifacts: StepArtifact[]
  /** Last transition — mirrors reference's `transition: Continue | undefined` */
  lastTransition: StepTransition | undefined
  abortController: AbortController
  globalDeadline: number
}

const STATE_DEPENDENT_ACTIONS = new Set(['navigate', 'input', 'click', 'press'])

function shouldReplayForResume(step: TestCaseDsl['steps'][number]): boolean {
  return STATE_DEPENDENT_ACTIONS.has(step.action)
}

// ── Report builder ────────────────────────────────────────────────────────────

function buildReport(
  state: TestRunState,
  startedAt: string,
  endedAt: string,
): TestReport {
  const passed = state.artifacts.filter(a => a.transition === 'success').length
  const skipped = state.artifacts.filter(a => a.transition === 'skip').length
  const failed = state.artifacts.filter(a => !a.success && a.transition !== 'skip').length
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime()

  const statusEmoji = state.status === 'completed' ? '✅' : state.status === 'failed' ? '❌' : '⚠️'
  const summary = [
    `# Test Report: ${state.dsl.name}`,
    ``,
    `**Status**: ${statusEmoji} ${state.status}`,
    `**Run ID**: ${state.id}`,
    `**Duration**: ${durationMs}ms`,
    ``,
    `## Steps`,
    ...state.artifacts.map(a =>
      `- **${a.step_id}** (${a.tool_name}): ${a.success ? '✅' : '❌'} ${a.transition}${a.error ? ` — ${a.error}` : ''}`
    ),
    ``,
    `**Passed**: ${passed} / **Skipped**: ${skipped} / **Failed**: ${failed}`,
  ].join('\n')

  return {
    run_id: state.id,
    test_name: state.dsl.name,
    status: state.status,
    total_steps: state.dsl.steps.length,
    passed_steps: passed,
    skipped_steps: skipped,
    failed_steps: failed,
    artifacts: state.artifacts,
    compile_report: state.dsl.compile_report,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    summary,
  }
}

// ── Main test loop ────────────────────────────────────────────────────────────

/**
 * Execute a compiled TestCaseDsl on a Playwright page.
 *
 * This is an async generator — callers receive step artifacts as they complete,
 * enabling real-time progress reporting.
 */
export async function* executeTestCase(
  params: TestLoopParams,
): AsyncGenerator<StepArtifact, TestReport> {
  const {
    dsl,
    page,
    sessionStore,
    maxRetries = 3,
    globalTimeoutMs = 120_000,
    screenshotDir = './data/screenshots',
    resumeFrom,
    resolver,
    resolverMemory,
  } = params

  const startedAt = resumeFrom?.started_at ?? new Date().toISOString()

  // Initialize or restore loop state
  const loopState: LoopState = {
    runId: resumeFrom?.id ?? generateRunId(),
    stepCursor: resumeFrom?.step_cursor ?? 0,
    retryCount: resumeFrom?.retry_count ?? 0,
    artifacts: resumeFrom?.artifacts ?? [],
    lastTransition: undefined,
    abortController: new AbortController(),
    globalDeadline: Date.now() + globalTimeoutMs,
  }

  const executor = new BrowserToolExecutor(page, {
    maxRetries,
    screenshotDir,
    resolver,
    resolverMemory,
  })

  // Build and persist initial run state
  let runState: TestRunState = {
    id: loopState.runId,
    status: 'running',
    step_cursor: loopState.stepCursor,
    retry_count: loopState.retryCount,
    dsl,
    artifacts: loopState.artifacts,
    started_at: startedAt,
  }
  await sessionStore.save(runState)

  // Rebuild browser state before resuming from a non-zero cursor.
  // This prevents dependency breakage when the previous browser session is gone.
  if (resumeFrom && loopState.stepCursor > 0) {
    for (let replayIndex = 0; replayIndex < loopState.stepCursor; replayIndex++) {
      const replayStep = dsl.steps[replayIndex]
      if (!replayStep || !shouldReplayForResume(replayStep)) continue

      let replayRetryCount = 0
      while (true) {
        const { artifact, transition } = await executor.executeStep(
          replayStep,
          replayRetryCount,
          loopState.abortController,
        )

        if (transition === 'success') {
          break
        }

        if (transition === 'retry' && replayRetryCount < maxRetries) {
          replayRetryCount++
          continue
        }

        runState = {
          ...runState,
          status: 'failed',
          step_cursor: loopState.stepCursor,
          failure_reason: `Resume precondition replay failed at ${replayStep.step_id}: ${artifact.error ?? 'unknown error'}`,
          ended_at: new Date().toISOString(),
        }
        await sessionStore.save(runState)
        return buildReport(runState, startedAt, runState.ended_at!)
      }
    }
  }

  // ── Bounded step loop ──────────────────────────────────────────────────────
  // Mirrors the reference's `while (true)` but bounded by dsl.steps.length.
  // We advance stepCursor manually to support retry (stay at same step).

  let stepIndex = loopState.stepCursor

  while (stepIndex < dsl.steps.length) {
    // Global timeout check (mirrors reference's maxTurns guard)
    if (Date.now() >= loopState.globalDeadline) {
      runState = {
        ...runState,
        status: 'failed',
        step_cursor: stepIndex,
        failure_reason: `Global timeout exceeded (${globalTimeoutMs}ms)`,
        ended_at: new Date().toISOString(),
      }
      await sessionStore.save(runState)
      return buildReport(runState, startedAt, runState.ended_at!)
    }

    // Abort check (mirrors reference's abortController.signal.aborted check)
    if (loopState.abortController.signal.aborted) {
      runState = {
        ...runState,
        status: 'killed',
        step_cursor: stepIndex,
        failure_reason: 'Manually killed',
        ended_at: new Date().toISOString(),
      }
      await sessionStore.save(runState)
      return buildReport(runState, startedAt, runState.ended_at!)
    }

    const step = dsl.steps[stepIndex]!

    // Execute the step
    const { artifact, transition } = await executor.executeStep(
      step,
      loopState.retryCount,
      loopState.abortController,
    )

    loopState.lastTransition = transition

    // Handle transition — finite state machine
    // Only valid transitions: success | retry | skip | fail_fast
    switch (transition) {
      case 'success': {
        loopState.artifacts.push(artifact)
        loopState.retryCount = 0
        stepIndex++
        break
      }
      case 'retry': {
        // Stay at current step — increment retry count
        // Note: we do NOT push the failed artifact yet; only push on final outcome
        loopState.retryCount++
        // Don't yield partial retries — only yield final outcome
        // Update state but don't advance cursor
        runState = {
          ...runState,
          step_cursor: stepIndex,
          retry_count: loopState.retryCount,
          artifacts: loopState.artifacts,
        }
        await sessionStore.save(runState)
        continue
      }
      case 'skip': {
        loopState.artifacts.push(artifact)
        loopState.retryCount = 0
        stepIndex++
        break
      }
      case 'fail_fast': {
        loopState.artifacts.push(artifact)
        yield artifact

        runState = {
          ...runState,
          status: 'failed',
          step_cursor: stepIndex,
          retry_count: loopState.retryCount,
          artifacts: loopState.artifacts,
          failure_reason: artifact.error ?? `Step ${step.step_id} failed (fail_fast)`,
          ended_at: new Date().toISOString(),
        }
        await sessionStore.save(runState)
        return buildReport(runState, startedAt, runState.ended_at!)
      }
    }

    // Yield the completed artifact to caller (for real-time progress)
    yield artifact

    // Persist snapshot after each successful step (for interrupt recovery)
    runState = {
      ...runState,
      status: 'running',
      step_cursor: stepIndex,
      retry_count: loopState.retryCount,
      artifacts: loopState.artifacts,
    }
    await sessionStore.save(runState)
  }

  // All steps completed
  const endedAt = new Date().toISOString()
  runState = {
    ...runState,
    status: 'completed',
    step_cursor: stepIndex,
    retry_count: 0,
    artifacts: loopState.artifacts,
    ended_at: endedAt,
  }
  await sessionStore.save(runState)

  return buildReport(runState, startedAt, endedAt)
}
