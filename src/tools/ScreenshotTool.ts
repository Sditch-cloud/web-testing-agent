/**
 * ScreenshotTool — capture a screenshot of the current page.
 * Returns structured evidence: screenshot_path, timestamp.
 */

import { z } from 'zod'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { Page } from 'playwright'
import type { Tool, ToolResult } from './Tool.js'

export const ScreenshotInputSchema = z.object({
  /** Directory to save the screenshot in */
  output_dir: z.string().default('./data/screenshots'),
  /** Optional filename (without extension) */
  filename: z.string().optional(),
  full_page: z.boolean().optional().default(false),
})

export type ScreenshotInput = z.infer<typeof ScreenshotInputSchema>

export class ScreenshotTool implements Tool<ScreenshotInput> {
  readonly name = 'screenshot'
  readonly description = 'Capture a screenshot of the current page state'
  readonly inputSchema = ScreenshotInputSchema

  constructor(private readonly page: Page) {}

  isConcurrencySafe(_input: ScreenshotInput): boolean {
    return false
  }

  async execute(input: ScreenshotInput, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      if (signal.aborted) throw new Error('Aborted before screenshot')

      await fs.mkdir(input.output_dir, { recursive: true })

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = input.filename
        ? `${input.filename}_${timestamp}.png`
        : `screenshot_${timestamp}.png`
      const screenshotPath = path.join(input.output_dir, filename)

      await this.page.screenshot({
        path: screenshotPath,
        fullPage: input.full_page,
      })

      const currentUrl = this.page.url()
      const title = await this.page.title()

      return {
        success: true,
        evidence: {
          screenshot_path: screenshotPath,
          timestamp: new Date().toISOString(),
          url: currentUrl,
          title,
        },
        duration_ms: Date.now() - startTime,
      }
    } catch (err) {
      return {
        success: false,
        evidence: {},
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      }
    }
  }
}
