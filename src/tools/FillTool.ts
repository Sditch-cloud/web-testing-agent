/**
 * FillTool — fill a text input field with a value.
 * Returns structured evidence: selector, filled_value.
 */

import { z } from 'zod'
import type { Page } from 'playwright'
import type { Tool, ToolResult } from './Tool.js'

export const FillInputSchema = z.object({
  selector: z.string().min(1),
  value: z.string(),
  timeout_ms: z.number().optional().default(10_000),
})

export type FillInput = z.infer<typeof FillInputSchema>

export class FillTool implements Tool<FillInput> {
  readonly name = 'fill'
  readonly description = 'Fill a text input field by CSS selector'
  readonly inputSchema = FillInputSchema

  constructor(private readonly page: Page) {}

  isConcurrencySafe(_input: FillInput): boolean {
    return false
  }

  async execute(input: FillInput, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      if (signal.aborted) throw new Error('Aborted before fill')

      const locator = this.page.locator(input.selector).first()
      await locator.waitFor({ state: 'visible', timeout: input.timeout_ms })
      await locator.fill(input.value, { timeout: input.timeout_ms })

      return {
        success: true,
        evidence: {
          selector: input.selector,
          filled_value: input.value,
        },
        duration_ms: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        evidence: { selector: input.selector },
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      }
    }
  }
}
