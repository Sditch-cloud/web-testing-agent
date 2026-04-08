/**
 * FillTool — fill a text input field with a value.
 * Returns structured evidence: selector, filled_value.
 */

import { z } from 'zod'
import type { Page } from 'playwright'
import type { Tool, ToolResult } from './Tool.js'

const CandidateSchema = z.object({
  id: z.string(),
  strategy: z.enum(['memory', 'label', 'role', 'text', 'fallback']),
  value: z.string().min(1),
  score: z.number(),
})

export const FillInputSchema = z.object({
  candidate: CandidateSchema,
  target_type: z.enum(['input', 'button', 'link', 'page', 'text']),
  value: z.string(),
  timeout_ms: z.number().optional().default(10_000),
})

export type FillInput = z.infer<typeof FillInputSchema>

export class FillTool implements Tool<FillInput> {
  readonly name = 'fill'
  readonly description = 'Fill a text input field resolved from semantic target candidates'
  readonly inputSchema = FillInputSchema

  constructor(private readonly page: Page) {}

  isConcurrencySafe(_input: FillInput): boolean {
    return false
  }

  async execute(input: FillInput, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      if (signal.aborted) throw new Error('Aborted before fill')

      const locator = this.resolveLocator(input)
      await locator.waitFor({ state: 'visible', timeout: input.timeout_ms })
      await locator.fill(input.value, { timeout: input.timeout_ms })

      return {
        success: true,
        evidence: {
          candidate: input.candidate,
          filled_value: input.value,
        },
        duration_ms: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        evidence: { candidate: input.candidate },
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      }
    }
  }

  private resolveLocator(input: FillInput) {
    const role = input.target_type === 'input'
      ? 'textbox'
      : input.target_type === 'button'
        ? 'button'
        : input.target_type === 'link'
          ? 'link'
          : null

    switch (input.candidate.strategy) {
      case 'label':
        return this.page.getByLabel(input.candidate.value).first()
      case 'role':
        if (role) {
          return this.page.getByRole(role, { name: input.candidate.value }).first()
        }
        return this.page.getByText(input.candidate.value).first()
      case 'text':
        return this.page.getByText(input.candidate.value).first()
      case 'memory':
      case 'fallback':
      default:
        return this.page.locator(input.candidate.value).first()
    }
  }
}
