/**
 * BrowserToolExecutor — serial tool executor for browser automation.
 *
 * Adapted from the claude-code reference StreamingToolExecutor, simplified:
 * - Pure serial execution (no concurrent branch — browser is shared state)
 * - Per-step AbortSignal check before every tool call
 * - Promise.race() timeout wrapper
 * - Retry logic: retry_count < maxRetries → retry, otherwise → skip/fail_fast
 * - Results bound to step_id and returned as StepArtifact[]
 *
 * Key difference from reference: no streaming, no concurrency partitioning.
 * We trade the generality for simplicity appropriate for a test runner.
 */

import type { Tool } from '../tools/Tool.js'
import type { StepDsl, ActionType } from '../types/TestDsl.js'
import type { StepArtifact, StepTransition } from '../types/Task.js'
import { NavigateTool } from '../tools/NavigateTool.js'
import { ClickTool } from '../tools/ClickTool.js'
import { FillTool } from '../tools/FillTool.js'
import { ScreenshotTool } from '../tools/ScreenshotTool.js'

export type ExecutorConfig = {
  maxRetries?: number
  defaultTimeoutMs?: number
  screenshotDir?: string
}

export type StepExecutionResult = {
  artifact: StepArtifact
  transition: StepTransition
}

// ── Error classification ───────────────────────────────────────────────────────

type ErrorCategory = 'element_not_found' | 'navigation_failed' | 'assertion_failed' | 'timeout' | 'aborted' | 'unknown'

function classifyError(error: string): ErrorCategory {
  const lower = error.toLowerCase()
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout'
  if (lower.includes('aborted') || lower.includes('abort')) return 'aborted'
  if (lower.includes('no element') || lower.includes('not found') || lower.includes('locator')) return 'element_not_found'
  if (lower.includes('navigation') || lower.includes('net::') || lower.includes('goto')) return 'navigation_failed'
  if (lower.includes('assert') || lower.includes('expect')) return 'assertion_failed'
  return 'unknown'
}

/** Retryable error categories — fail_fast otherwise */
const RETRYABLE_ERRORS: ErrorCategory[] = ['element_not_found', 'timeout', 'unknown']

function isRetryable(error: string): boolean {
  return RETRYABLE_ERRORS.includes(classifyError(error))
}

// ── Assertion executor ────────────────────────────────────────────────────────

import type { Page } from 'playwright'
import type { AssertionDsl } from '../types/TestDsl.js'

async function runAssertions(
  page: Page,
  assertions: AssertionDsl[],
  timeoutMs: number,
): Promise<{ passed: boolean; error?: string }> {
  for (const assertion of assertions) {
    try {
      switch (assertion.type) {
        case 'text_contains': {
          const content = await page.locator(assertion.target).textContent({ timeout: timeoutMs })
          if (!content?.includes(assertion.value ?? '')) {
            return { passed: false, error: `text_contains: "${assertion.value}" not found in "${content}"` }
          }
          break
        }
        case 'url_matches': {
          const currentUrl = page.url()
          if (!currentUrl.includes(assertion.value ?? '')) {
            return { passed: false, error: `url_matches: "${assertion.value}" not found in URL "${currentUrl}"` }
          }
          break
        }
        case 'element_visible': {
          await page.locator(assertion.target).waitFor({ state: 'visible', timeout: timeoutMs })
          break
        }
        case 'element_not_visible': {
          await page.locator(assertion.target).waitFor({ state: 'hidden', timeout: timeoutMs })
          break
        }
      }
    } catch (err) {
      return { passed: false, error: `assertion_failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  return { passed: true }
}

// ── Browser tool executor ─────────────────────────────────────────────────────

export class BrowserToolExecutor {
  private readonly maxRetries: number
  private readonly defaultTimeoutMs: number
  private readonly screenshotDir: string

  constructor(
    private readonly page: Page,
    config: ExecutorConfig = {},
  ) {
    this.maxRetries = config.maxRetries ?? 3
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 15_000
    this.screenshotDir = config.screenshotDir ?? './data/screenshots'
  }

  private getToolForAction(action: ActionType): Tool | null {
    switch (action) {
      case 'navigate': return new NavigateTool(this.page)
      case 'click': return new ClickTool(this.page)
      case 'fill': return new FillTool(this.page)
      case 'screenshot': return new ScreenshotTool(this.page)
      case 'assert': return null // Assertions are handled separately
    }
  }

  private buildToolInput(step: StepDsl): Record<string, unknown> {
    const base: Record<string, unknown> = {
      timeout_ms: step.timeout_ms ?? this.defaultTimeoutMs,
    }
    switch (step.action) {
      case 'navigate': return { ...base, url: step.target }
      case 'click': return { ...base, selector: step.target }
      case 'fill': return { ...base, selector: step.target, value: step.value ?? '' }
      case 'screenshot': return { ...base, output_dir: this.screenshotDir, filename: step.step_id }
      case 'assert': return base
    }
  }

  /**
   * Execute a single DSL step with retry logic.
   * Returns a StepArtifact bound to step_id and the resulting transition.
   */
  async executeStep(
    step: StepDsl,
    retryCount: number,
    abortController: AbortController,
  ): Promise<StepExecutionResult> {
    const startedAt = new Date().toISOString()
    const timeoutMs = step.timeout_ms ?? this.defaultTimeoutMs

    // Check abort before starting
    if (abortController.signal.aborted) {
      return this.makeArtifact(step, startedAt, false, {}, 'Aborted', retryCount + 1, 'fail_fast')
    }

    let success = false
    let evidence: Record<string, unknown> = {}
    let error: string | undefined

    try {
      if (step.action === 'assert') {
        // Assertion: local retry loop (not outer loop) — wait up to timeoutMs
        const assertions = step.assertions ?? []
        const assertResult = await this.withTimeout(
          runAssertions(this.page, assertions, timeoutMs),
          timeoutMs,
          `Assert step ${step.step_id} timed out`,
        )
        success = assertResult.passed
        evidence = { assertions_checked: assertions.length }
        error = assertResult.error
      } else {
        const tool = this.getToolForAction(step.action)
        if (!tool) throw new Error(`No tool for action: ${step.action}`)

        const input = this.buildToolInput(step)
        const parsed = tool.inputSchema.safeParse(input)
        if (!parsed.success) {
          throw new Error(`Invalid tool input: ${parsed.error.message}`)
        }

        const result = await this.withTimeout(
          tool.execute(parsed.data as Record<string, unknown>, abortController.signal),
          timeoutMs,
          `Tool ${step.action} timed out after ${timeoutMs}ms`,
        )
        success = result.success
        evidence = result.evidence
        error = result.error
      }
    } catch (err) {
      success = false
      error = err instanceof Error ? err.message : String(err)
    }

    const transition = this.determineTransition(success, error, retryCount)
    return this.makeArtifact(step, startedAt, success, evidence, error, retryCount + 1, transition)
  }

  private determineTransition(
    success: boolean,
    error: string | undefined,
    retryCount: number,
  ): StepTransition {
    if (success) return 'success'
    if (error && classifyError(error) === 'aborted') return 'fail_fast'
    if (retryCount < this.maxRetries && isRetryable(error ?? '')) return 'retry'
    return 'fail_fast'
  }

  private makeArtifact(
    step: StepDsl,
    startedAt: string,
    success: boolean,
    evidence: Record<string, unknown>,
    error: string | undefined,
    attemptCount: number,
    transition: StepTransition,
  ): StepExecutionResult {
    const artifact: StepArtifact = {
      step_id: step.step_id,
      tool_name: step.action,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      success,
      evidence,
      error,
      attempt_count: attemptCount,
      transition,
    }
    return { artifact, transition }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(message)), ms),
      ),
    ])
  }
}
