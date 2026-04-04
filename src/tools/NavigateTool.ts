/**
 * NavigateTool — navigate the browser to a URL.
 * Returns structured evidence: url, title, load_time_ms.
 */

import { z } from 'zod'
import type { Page } from 'playwright'
import type { Tool, ToolResult } from './Tool.js'

export const NavigateInputSchema = z.object({
  url: z.string().url(),
  timeout_ms: z.number().optional().default(30_000),
})

export type NavigateInput = z.infer<typeof NavigateInputSchema>

export class NavigateTool implements Tool<NavigateInput> {
  readonly name = 'navigate'
  readonly description = 'Navigate the browser to a URL'
  readonly inputSchema = NavigateInputSchema

  constructor(private readonly page: Page) {}

  isConcurrencySafe(_input: NavigateInput): boolean {
    return false
  }

  async execute(input: NavigateInput, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      if (signal.aborted) throw new Error('Aborted before navigation')

      const response = await this.page.goto(input.url, {
        timeout: input.timeout_ms,
        waitUntil: 'domcontentloaded',
      })

      const title = await this.page.title()
      const finalUrl = this.page.url()
      const duration_ms = Date.now() - startTime

      return {
        success: true,
        evidence: {
          url: finalUrl,
          requested_url: input.url,
          title,
          status_code: response?.status() ?? null,
          load_time_ms: duration_ms,
        },
        duration_ms,
      }
    } catch (err) {
      return {
        success: false,
        evidence: { url: input.url },
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      }
    }
  }
}
