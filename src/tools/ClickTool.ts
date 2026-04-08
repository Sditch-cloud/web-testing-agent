/**
 * ClickTool — click a DOM element by CSS selector.
 * Returns structured evidence: selector, element_text, coordinates.
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

export const ClickInputSchema = z.object({
  candidate: CandidateSchema,
  target_type: z.enum(['input', 'button', 'link', 'page', 'text']),
  timeout_ms: z.number().optional().default(10_000),
})

export type ClickInput = z.infer<typeof ClickInputSchema>

export class ClickTool implements Tool<ClickInput> {
  readonly name = 'click'
  readonly description = 'Click a DOM element resolved from semantic target candidates'
  readonly inputSchema = ClickInputSchema

  constructor(private readonly page: Page) {}

  isConcurrencySafe(_input: ClickInput): boolean {
    return false
  }

  async execute(input: ClickInput, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      if (signal.aborted) throw new Error('Aborted before click')

      const locator = this.resolveLocator(input)
      await locator.waitFor({ state: 'visible', timeout: input.timeout_ms })

      const boundingBox = await locator.boundingBox()
      const elementText = await locator.textContent().catch(() => null)

      await locator.click({ timeout: input.timeout_ms })

      return {
        success: true,
        evidence: {
          candidate: input.candidate,
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
        evidence: { candidate: input.candidate },
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      }
    }
  }

  private resolveLocator(input: ClickInput) {
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
