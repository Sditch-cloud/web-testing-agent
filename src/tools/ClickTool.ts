/**
 * ClickTool — click a DOM element by CSS selector.
 * Returns structured evidence: selector, element_text, coordinates.
 */

import { z } from 'zod'
import type { Page } from 'playwright'
import type { Tool, ToolResult } from './Tool.js'

export const ClickInputSchema = z.object({
  selector: z.string().min(1),
  timeout_ms: z.number().optional().default(10_000),
})

export type ClickInput = z.infer<typeof ClickInputSchema>

export class ClickTool implements Tool<ClickInput> {
  readonly name = 'click'
  readonly description = 'Click a DOM element identified by CSS selector'
  readonly inputSchema = ClickInputSchema

  constructor(private readonly page: Page) {}

  isConcurrencySafe(_input: ClickInput): boolean {
    return false
  }

  async execute(input: ClickInput, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      if (signal.aborted) throw new Error('Aborted before click')

      const locator = this.page.locator(input.selector).first()
      await locator.waitFor({ state: 'visible', timeout: input.timeout_ms })

      const boundingBox = await locator.boundingBox()
      const elementText = await locator.textContent().catch(() => null)

      await locator.click({ timeout: input.timeout_ms })

      return {
        success: true,
        evidence: {
          selector: input.selector,
          element_text: elementText?.trim() ?? null,
          coordinates: boundingBox
            ? { x: Math.round(boundingBox.x + boundingBox.width / 2), y: Math.round(boundingBox.y + boundingBox.height / 2) }
            : null,
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
