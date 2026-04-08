/**
 * BrowserToolExecutor — serial tool executor for browser automation.
 *
 * Semantic execution flow:
 * 1. Resolve semantic target into Top-K candidates
 * 2. Try candidates sequentially
 * 3. Record successful candidate into resolver memory
 */

import type { Page } from 'playwright'
import type { Tool } from '../tools/Tool.js'
import { NavigateTool } from '../tools/NavigateTool.js'
import { ClickTool } from '../tools/ClickTool.js'
import { FillTool } from '../tools/FillTool.js'
import { ScreenshotTool } from '../tools/ScreenshotTool.js'
import type { ActionType, AssertionDsl, StepDsl } from '../types/TestDsl.js'
import type { StepArtifact, StepTransition } from '../types/Task.js'
import {
  PlaywrightElementResolver,
  inferUrlFromTarget,
  isResolverAction,
  resolvePressKey,
} from '../resolver/ElementResolver.js'
import type { Candidate, ElementResolver, ResolverMemory } from '../resolver/types.js'

export type ExecutorConfig = {
  maxRetries?: number
  defaultTimeoutMs?: number
  screenshotDir?: string
  resolver?: ElementResolver
  resolverMemory?: ResolverMemory
}

export type StepExecutionResult = {
  artifact: StepArtifact
  transition: StepTransition
}

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

const RETRYABLE_ERRORS: ErrorCategory[] = ['element_not_found', 'timeout', 'unknown']

function isRetryable(error: string): boolean {
  return RETRYABLE_ERRORS.includes(classifyError(error))
}

export class BrowserToolExecutor {
  private readonly maxRetries: number
  private readonly defaultTimeoutMs: number
  private readonly screenshotDir: string
  private readonly resolver: ElementResolver
  private readonly resolverMemory?: ResolverMemory

  constructor(
    private readonly page: Page,
    config: ExecutorConfig = {},
  ) {
    this.maxRetries = config.maxRetries ?? 3
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 15_000
    this.screenshotDir = config.screenshotDir ?? './data/screenshots'
    this.resolverMemory = config.resolverMemory
    this.resolver = config.resolver ?? new PlaywrightElementResolver(this.resolverMemory)
  }

  private getToolForAction(action: ActionType): Tool | null {
    switch (action) {
      case 'navigate': return new NavigateTool(this.page)
      case 'click': return new ClickTool(this.page)
      case 'input': return new FillTool(this.page)
      case 'screenshot': return new ScreenshotTool(this.page)
      case 'press':
      case 'assert':
        return null
    }
  }

  async executeStep(
    step: StepDsl,
    retryCount: number,
    abortController: AbortController,
  ): Promise<StepExecutionResult> {
    const startedAt = new Date().toISOString()
    const timeoutMs = step.timeout_ms ?? this.defaultTimeoutMs

    if (abortController.signal.aborted) {
      return this.makeArtifact(step, startedAt, false, {}, 'Aborted', retryCount + 1, 'fail_fast')
    }

    let success = false
    let evidence: Record<string, unknown> = {}
    let error: string | undefined
    let attemptedCandidates: Candidate[] = []
    let resolvedCandidate: Candidate | undefined
    let healingApplied = false

    try {
      if (step.action === 'assert') {
        const assertResult = await this.withTimeout(
          this.runAssertions(step.assertions ?? [], timeoutMs),
          timeoutMs,
          `Assert step ${step.step_id} timed out`,
        )
        success = assertResult.passed
        evidence = { assertions_checked: (step.assertions ?? []).length }
        error = assertResult.error
      } else if (step.action === 'press') {
        const key = resolvePressKey(step.value, step.target)
        await this.withTimeout(this.page.keyboard.press(key), timeoutMs, `Press step ${step.step_id} timed out`)
        success = true
        evidence = { pressed_key: key }
      } else if (step.action === 'navigate') {
        const tool = this.getToolForAction(step.action)
        if (!tool) throw new Error(`No tool for action: ${step.action}`)
        const url = inferUrlFromTarget(step.value, step.target)
        const parsed = tool.inputSchema.safeParse({ url, timeout_ms: timeoutMs })
        if (!parsed.success) throw new Error(`Invalid navigate input: ${parsed.error.message}`)
        const result = await this.withTimeout(
          tool.execute(parsed.data as Record<string, unknown>, abortController.signal),
          timeoutMs,
          `Tool ${step.action} timed out after ${timeoutMs}ms`,
        )
        success = result.success
        evidence = result.evidence
        error = result.error
      } else if (isResolverAction(step.action)) {
        const result = await this.executeResolverAction(step, timeoutMs, abortController.signal)
        success = result.success
        evidence = result.evidence
        error = result.error
        attemptedCandidates = result.attemptedCandidates
        resolvedCandidate = result.resolvedCandidate
        healingApplied = result.healingApplied
      } else if (step.action === 'screenshot') {
        const tool = this.getToolForAction(step.action)
        if (!tool) throw new Error(`No tool for action: ${step.action}`)
        const parsed = tool.inputSchema.safeParse({ output_dir: this.screenshotDir, filename: step.step_id, timeout_ms: timeoutMs })
        if (!parsed.success) throw new Error(`Invalid screenshot input: ${parsed.error.message}`)

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
    return this.makeArtifact(
      step,
      startedAt,
      success,
      evidence,
      error,
      retryCount + 1,
      transition,
      attemptedCandidates,
      resolvedCandidate,
      healingApplied,
    )
  }

  private async executeResolverAction(
    step: StepDsl,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{
    success: boolean
    evidence: Record<string, unknown>
    error?: string
    attemptedCandidates: Candidate[]
    resolvedCandidate?: Candidate
    healingApplied: boolean
  }> {
    const candidates = (await this.resolver.resolve(this.page, step.target, { action: step.action, k: 3 })).candidates
    if (candidates.length === 0) {
      return {
        success: false,
        error: `No resolver candidates for target: ${step.target.key}`,
        evidence: {},
        attemptedCandidates: [],
        healingApplied: false,
      }
    }

    const attemptedCandidates: Candidate[] = []
    let lastError: string | undefined
    const tool = this.getToolForAction(step.action)

    for (const candidate of candidates) {
      if (signal.aborted) {
        return {
          success: false,
          error: 'Aborted during candidate execution',
          evidence: {},
          attemptedCandidates,
          healingApplied: false,
        }
      }

      attemptedCandidates.push(candidate)

      if (!tool) {
        return {
          success: false,
          error: `No tool for resolver action: ${step.action}`,
          evidence: {},
          attemptedCandidates,
          healingApplied: false,
        }
      }

      const parsed = tool.inputSchema.safeParse({
        candidate,
        target_type: step.target.type,
        value: step.value ?? '',
        timeout_ms: timeoutMs,
      })

      if (!parsed.success) {
        lastError = parsed.error.message
        continue
      }

      const result = await this.withTimeout(
        tool.execute(parsed.data as Record<string, unknown>, signal),
        timeoutMs,
        `Tool ${step.action} timed out after ${timeoutMs}ms`,
      )

      if (!result.success) {
        lastError = result.error ?? 'Unknown execution failure'
        continue
      }

      if (this.resolverMemory) {
        await this.resolverMemory.recordSuccess(step.target.key, step.action, candidate)
      }

      return {
        success: true,
        evidence: result.evidence,
        attemptedCandidates,
        resolvedCandidate: candidate,
        healingApplied: Boolean(this.resolverMemory),
      }
    }

    return {
      success: false,
      evidence: {},
      error: lastError ?? `Failed all resolver candidates for target: ${step.target.key}`,
      attemptedCandidates,
      healingApplied: false,
    }
  }

  private async runAssertions(
    assertions: AssertionDsl[],
    timeoutMs: number,
  ): Promise<{ passed: boolean; error?: string }> {
    for (const assertion of assertions) {
      try {
        if (assertion.type === 'url_matches') {
          const currentUrl = this.page.url()
          if (!currentUrl.includes(assertion.value ?? '')) {
            return { passed: false, error: `url_matches: \"${assertion.value}\" not found in URL \"${currentUrl}\"` }
          }
          continue
        }

        const { candidates } = await this.resolver.resolve(this.page, assertion.target, { action: 'assert', k: 3 })
        if (candidates.length === 0) {
          return { passed: false, error: `assertion_failed: no candidates for ${assertion.target.key}` }
        }

        let assertionPassed = false
        let assertionError = 'assertion_failed: all candidates failed'

        for (const candidate of candidates) {
          const locator = this.resolver.locatorForCandidate(this.page, assertion.target, candidate)
          try {
            if (assertion.type === 'text_contains') {
              const content = await locator.textContent({ timeout: timeoutMs })
              if (content?.includes(assertion.value ?? '')) {
                assertionPassed = true
                break
              }
              assertionError = `text_contains: \"${assertion.value}\" not found in \"${content}\"`
            } else if (assertion.type === 'element_visible') {
              await locator.waitFor({ state: 'visible', timeout: timeoutMs })
              assertionPassed = true
              break
            } else if (assertion.type === 'element_not_visible') {
              await locator.waitFor({ state: 'hidden', timeout: timeoutMs })
              assertionPassed = true
              break
            }
          } catch (err) {
            assertionError = `assertion_failed: ${err instanceof Error ? err.message : String(err)}`
          }
        }

        if (!assertionPassed) {
          return { passed: false, error: assertionError }
        }
      } catch (err) {
        return { passed: false, error: `assertion_failed: ${err instanceof Error ? err.message : String(err)}` }
      }
    }

    return { passed: true }
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
    attemptedCandidates?: Candidate[],
    resolvedCandidate?: Candidate,
    healingApplied?: boolean,
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
      ...(attemptedCandidates && attemptedCandidates.length > 0
        ? {
            attempted_candidates: attemptedCandidates.map(candidate => ({
              strategy: candidate.strategy,
              value: candidate.value,
              score: candidate.score,
            })),
          }
        : {}),
      ...(resolvedCandidate
        ? {
            resolved_candidate: {
              strategy: resolvedCandidate.strategy,
              value: resolvedCandidate.value,
              score: resolvedCandidate.score,
            },
          }
        : {}),
      ...(healingApplied !== undefined ? { healing_applied: healingApplied } : {}),
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
