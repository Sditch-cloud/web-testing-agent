/**
 * Base Tool interface for the Web Testing Agent.
 *
 * Adapted from the claude-code reference Tool.ts interface:
 * - name, inputSchema (Zod), isConcurrencySafe(), execute()
 *
 * Key difference: all browser tools return structured evidence
 * bound to a step_id, and isConcurrencySafe() is always false
 * because the browser is shared state.
 */

import { z } from 'zod'

// ── Tool evidence (structured output from each tool call) ─────────────────────

export type ToolEvidence = Record<string, unknown>

export type ToolResult = {
  success: boolean
  evidence: ToolEvidence
  error?: string
  duration_ms: number
}

// ── Base tool interface ───────────────────────────────────────────────────────

export type ToolInput = Record<string, unknown>

export interface Tool<TInput extends ToolInput = ToolInput> {
  readonly name: string
  readonly description: string
  // Use ZodTypeAny to accommodate ZodDefault fields whose _input type differs from _output
  readonly inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>

  /**
   * Whether this tool can safely run concurrently with other tools.
   * All browser tools return false — the browser page is shared state.
   */
  isConcurrencySafe(input: TInput): boolean

  /**
   * Execute the tool and return structured evidence.
   * The executor binds the step_id to the result.
   */
  execute(input: TInput, signal: AbortSignal): Promise<ToolResult>
}

// ── Utility: find a tool by name ──────────────────────────────────────────────

export function findToolByName(tools: Tool[], name: string): Tool | undefined {
  return tools.find(t => t.name === name)
}
