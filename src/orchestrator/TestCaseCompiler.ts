/**
 * TestCaseCompiler — Natural Language → TestCaseDsl
 *
 * Two-phase compilation:
 * 1. Rule-based normalization: extract URL, split steps, identify preconditions
 * 2. OpenAI call: produce structured TestCaseDsl JSON matching the schema
 *
 * Adapted from the claude-code reference pattern of using LLM as a structured
 * output producer, but here the output is a deterministic DSL rather than
 * open-ended tool invocations.
 */

import OpenAI from 'openai'
import type {
  TestCaseDsl,
  StepDsl,
  CompileReport,
  CompileWarning,
  CompileError,
} from '../types/TestDsl.js'

// ── Config ────────────────────────────────────────────────────────────────────

export type CompilerConfig = {
  apiKey: string
  baseURL?: string
  model?: string
  maxTokens?: number
  /** If provided, hints are injected into the system prompt */
  hints?: string[]
}

export type CompileResult = {
  dsl: TestCaseDsl | null
  report: CompileReport
  /** Raw JSON returned by LLM (for debugging) */
  raw_output?: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// ── JSON schema for DSL output (passed to OpenAI as response_format) ─────────

const DSL_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step_id: { type: 'string' },
          action: { type: 'string', enum: ['navigate', 'click', 'fill', 'screenshot', 'assert'] },
          target: { type: 'string' },
          value: { type: 'string' },
          assertions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['text_contains', 'url_matches', 'element_visible', 'element_not_visible'] },
                target: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['type', 'target'],
            },
          },
          timeout_ms: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['step_id', 'action'],
      },
    },
    compile_report: {
      type: 'object',
      properties: {
        confidence: { type: 'number' },
        warnings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step_id: { type: 'string' },
              code: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step_id: { type: 'string' },
              code: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
      },
      required: ['confidence', 'warnings', 'errors'],
    },
  },
  required: ['id', 'name', 'url', 'steps', 'compile_report'],
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(hints?: string[]): string {
  const hintsSection = hints && hints.length > 0
    ? `\n\nAdditional context hints:\n${hints.map(h => `- ${h}`).join('\n')}`
    : ''

  return `You are a test case compiler that converts natural language test descriptions into structured JSON DSL.

Your output MUST be a valid JSON object matching this schema:
- id: short unique ID like "tc_<hash>" (generate from test name)
- name: concise human-readable test name
- url: the starting URL for the test (extract from description or use a placeholder)
- steps: ordered array of test steps, each with:
  - step_id: "s1", "s2", etc.
  - action: one of navigate | click | fill | screenshot | assert
  - target: CSS selector, URL, or text pattern (required for all actions except screenshot)
  - value: text to type (for fill), or expected value (for assert text_contains)
  - assertions: array for assert steps, each with type, target, value
  - description: human-readable step description
- compile_report:
  - confidence: 0.0–1.0 (how confident you are in the compilation)
  - warnings: steps with ambiguous selectors or inferred values (non-fatal)
  - errors: steps that could not be resolved (fatal — these steps will fail validation)

RULES:
1. Always start with a navigate step if a URL is mentioned.
2. Split compound actions ("login and then click checkout") into separate steps.
3. For buttons/links without a selector, use text-based selectors like button:has-text("Login").
4. If a selector is ambiguous, mark it with a warning and use a reasonable guess.
5. Use step_id values "s1", "s2", etc. sequentially.
6. Keep step descriptions in the same language as the input.
7. Always include a final screenshot step as the last step.${hintsSection}`
}

// ── Rule-based pre-normalization ──────────────────────────────────────────────

function extractUrl(nlInput: string): string | null {
  const urlRegex = /https?:\/\/[^\s，。,\s]+/
  const match = urlRegex.exec(nlInput)
  return match ? match[0] : null
}

function normalizeInput(nlInput: string): string {
  // Trim and collapse whitespace
  return nlInput.trim().replace(/\s+/g, ' ')
}

// ── Compiler ──────────────────────────────────────────────────────────────────

export class TestCaseCompiler {
  private readonly client: OpenAI
  private readonly model: string
  private readonly maxTokens: number
  private readonly hints: string[]

  constructor(config: CompilerConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
    this.model = config.model ?? 'gpt-4o'
    this.maxTokens = config.maxTokens ?? 4096
    this.hints = config.hints ?? []
  }

  async compile(nlInput: string): Promise<CompileResult> {
    const compiledAt = new Date().toISOString()
    const normalized = normalizeInput(nlInput)
    const detectedUrl = extractUrl(normalized)

    const systemPrompt = buildSystemPrompt(this.hints)
    const userMessage = detectedUrl
      ? `Compile this test case. The starting URL appears to be: ${detectedUrl}\n\n${normalized}`
      : normalized

    let rawOutput: string | undefined
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'TestCaseDsl',
            strict: true,
            schema: DSL_SCHEMA,
          },
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      })

      rawOutput = response.choices[0]?.message?.content ?? ''
      usage = {
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      }

      const parsed = JSON.parse(rawOutput) as Omit<TestCaseDsl, 'compile_report'> & {
        compile_report: Omit<CompileReport, 'source_nl' | 'compiled_at'>
      }

      // Inject server-side fields into compile_report
      const dsl: TestCaseDsl = {
        ...parsed,
        steps: parsed.steps as StepDsl[],
        compile_report: {
          ...parsed.compile_report,
          warnings: (parsed.compile_report.warnings ?? []) as CompileWarning[],
          errors: (parsed.compile_report.errors ?? []) as CompileError[],
          source_nl: nlInput,
          compiled_at: compiledAt,
        },
      }

      return { dsl, report: dsl.compile_report, raw_output: rawOutput, usage }
    } catch (err) {
      const report: CompileReport = {
        confidence: 0,
        warnings: [],
        errors: [
          {
            code: 'COMPILE_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        source_nl: nlInput,
        compiled_at: compiledAt,
      }
      return { dsl: null, report, raw_output: rawOutput, usage }
    }
  }
}
