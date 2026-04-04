import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TestCaseDsl } from '../../src/types/TestDsl.js'
import type { TestRunState } from '../../src/types/Task.js'

// ── Minimal mocks ─────────────────────────────────────────────────────────────

const mockGoto = vi.fn().mockResolvedValue({ status: () => 200 })
const mockTitle = vi.fn().mockResolvedValue('Test Page')
const mockUrl = vi.fn().mockReturnValue('https://example.com')
const mockScreenshot = vi.fn().mockResolvedValue(undefined)
const mockLocator = vi.fn().mockReturnValue({
  waitFor: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  fill: vi.fn().mockResolvedValue(undefined),
  textContent: vi.fn().mockResolvedValue('Welcome'),
  boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 10, width: 100, height: 40 }),
  first: vi.fn().mockReturnThis(),
})

const mockPage = {
  goto: mockGoto,
  title: mockTitle,
  url: mockUrl,
  screenshot: mockScreenshot,
  locator: mockLocator,
}

const mockSessionStore = {
  save: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue(null),
}

const simpleDsl: TestCaseDsl = {
  id: 'tc_001',
  name: 'Simple Navigation Test',
  url: 'https://example.com',
  steps: [
    { step_id: 's1', action: 'navigate', target: 'https://example.com' },
    { step_id: 's2', action: 'screenshot' },
  ],
  compile_report: {
    confidence: 0.95,
    warnings: [],
    errors: [],
    source_nl: 'Navigate to example.com and take a screenshot',
    compiled_at: new Date().toISOString(),
  },
}

describe('testLoop — executeTestCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUrl.mockReturnValue('https://example.com')
  })

  it('completes all steps and returns a report', async () => {
    const { executeTestCase } = await import('../../src/orchestrator/testLoop.js')

    const artifacts = []
    const generator = executeTestCase({
      dsl: simpleDsl,
      page: mockPage as never,
      sessionStore: mockSessionStore as never,
      maxRetries: 1,
      globalTimeoutMs: 30_000,
    })

    let report = null
    while (true) {
      const { value, done } = await generator.next()
      if (done) { report = value; break }
      artifacts.push(value)
    }

    expect(report).not.toBeNull()
    expect(report!.status).toBe('completed')
    expect(report!.total_steps).toBe(2)
    expect(report!.passed_steps).toBe(2)
    expect(artifacts).toHaveLength(2)
  })

  it('saves session snapshot after each step', async () => {
    const { executeTestCase } = await import('../../src/orchestrator/testLoop.js')

    const generator = executeTestCase({
      dsl: simpleDsl,
      page: mockPage as never,
      sessionStore: mockSessionStore as never,
    })

    while (!(await generator.next()).done) { /* consume */ }

    // Should be called: initial + after each step + final = 1 + 2 + 1 = 4 times
    expect(mockSessionStore.save).toHaveBeenCalledTimes(4)
  })

  it('yields step artifacts as they complete', async () => {
    const { executeTestCase } = await import('../../src/orchestrator/testLoop.js')

    const yieldedArtifacts: unknown[] = []
    const generator = executeTestCase({
      dsl: simpleDsl,
      page: mockPage as never,
      sessionStore: mockSessionStore as never,
    })

    while (true) {
      const { value, done } = await generator.next()
      if (done) break
      yieldedArtifacts.push(value)
    }

    expect(yieldedArtifacts).toHaveLength(2)
    expect((yieldedArtifacts[0] as { step_id: string }).step_id).toBe('s1')
    expect((yieldedArtifacts[1] as { step_id: string }).step_id).toBe('s2')
  })

  it('resumes from a saved state', async () => {
    const { executeTestCase } = await import('../../src/orchestrator/testLoop.js')

    const partialState: TestRunState = {
      id: 'run_resume_test',
      status: 'running',
      step_cursor: 1, // Already completed s1
      retry_count: 0,
      dsl: simpleDsl,
      artifacts: [
        {
          step_id: 's1',
          tool_name: 'navigate',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          success: true,
          evidence: { url: 'https://example.com' },
          attempt_count: 1,
          transition: 'success',
        },
      ],
      started_at: new Date().toISOString(),
    }

    const generator = executeTestCase({
      dsl: simpleDsl,
      page: mockPage as never,
      sessionStore: mockSessionStore as never,
      resumeFrom: partialState,
    })

    const yieldedArtifacts: unknown[] = []
    let report = null
    while (true) {
      const { value, done } = await generator.next()
      if (done) { report = value; break }
      yieldedArtifacts.push(value)
    }

    // Only s2 should be executed (s1 was already done)
    expect(yieldedArtifacts).toHaveLength(1)
    expect((yieldedArtifacts[0] as { step_id: string }).step_id).toBe('s2')
    expect(report!.passed_steps).toBe(2) // s1 from resume + s2 just executed
  })
})
