import { describe, expect, it, vi } from 'vitest'
import { BrowserToolExecutor } from '../../src/executor/BrowserToolExecutor.js'
import type { Candidate, ElementResolver, ResolverMemory } from '../../src/resolver/types.js'
import type { StepDsl } from '../../src/types/TestDsl.js'

function makeLocator(candidateValue: string) {
  return {
    first: vi.fn().mockReturnThis(),
    waitFor: vi.fn().mockImplementation(async () => {
      if (candidateValue === '[data-testid=slow]') {
        await new Promise(() => undefined)
      }
      if (candidateValue === '[data-testid=bad]') {
        throw new Error('element not found')
      }
    }),
    click: vi.fn().mockImplementation(async () => {
      if (candidateValue === '[data-testid=bad]') {
        throw new Error('click failed')
      }
    }),
    fill: vi.fn().mockResolvedValue(undefined),
    textContent: vi.fn().mockResolvedValue('Login'),
    boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 10, width: 100, height: 40 }),
  }
}

function createMockPage() {
  return {
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue('Test Page'),
    url: vi.fn().mockReturnValue('https://example.com'),
    screenshot: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    locator: vi.fn().mockImplementation((selector: string) => makeLocator(selector)),
    getByLabel: vi.fn().mockImplementation((label: string) => makeLocator(label)),
    getByRole: vi.fn().mockImplementation((_role: string, options: { name: string }) => makeLocator(options.name)),
    getByText: vi.fn().mockImplementation((text: string) => makeLocator(text)),
  }
}

describe('BrowserToolExecutor', () => {
  it('tries Top-K candidates sequentially and records successful candidate', async () => {
    const page = createMockPage()

    const resolver: ElementResolver = {
      async resolve() {
        const candidates: Candidate[] = [
          { id: 'c1', strategy: 'fallback', value: '[data-testid=bad]', score: 0.91 },
          { id: 'c2', strategy: 'fallback', value: '[data-testid=good]', score: 0.87 },
          { id: 'c3', strategy: 'text', value: 'Login', score: 0.82 },
        ]
        return { candidates }
      },
      locatorForCandidate(pageLike, _target, candidate) {
        return pageLike.locator(candidate.value).first()
      },
    }

    const memory: ResolverMemory = {
      getCandidates: vi.fn().mockResolvedValue([]),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
    }

    const executor = new BrowserToolExecutor(page as never, {
      resolver,
      resolverMemory: memory,
      maxRetries: 0,
    })

    const step: StepDsl = {
      step_id: 's1',
      action: 'click',
      target: {
        key: 'login_submit',
        type: 'button',
        hints: ['Login'],
      },
    }

    const { artifact, transition } = await executor.executeStep(step, 0, new AbortController())

    expect(transition).toBe('success')
    expect(artifact.success).toBe(true)
    expect(artifact.attempted_candidates?.length).toBe(2)
    expect(artifact.resolved_candidate?.value).toBe('[data-testid=good]')
    expect(artifact.healing_applied).toBe(true)
    expect(memory.recordSuccess).toHaveBeenCalledTimes(1)
    expect(memory.recordSuccess).toHaveBeenCalledWith(
      'login_submit',
      'click',
      expect.objectContaining({ value: '[data-testid=good]' }),
    )
  })

  it('continues to next candidate when first candidate times out', async () => {
    const page = createMockPage()

    const resolver: ElementResolver = {
      async resolve() {
        const candidates: Candidate[] = [
          { id: 'c1', strategy: 'fallback', value: '[data-testid=slow]', score: 0.91 },
          { id: 'c2', strategy: 'fallback', value: '[data-testid=good]', score: 0.87 },
        ]
        return { candidates }
      },
      locatorForCandidate(pageLike, _target, candidate) {
        return pageLike.locator(candidate.value).first()
      },
    }

    const executor = new BrowserToolExecutor(page as never, {
      resolver,
      maxRetries: 0,
      defaultTimeoutMs: 20,
    })

    const step: StepDsl = {
      step_id: 's1',
      action: 'click',
      timeout_ms: 20,
      target: {
        key: 'login_submit',
        type: 'button',
        hints: ['Login'],
      },
    }

    const { artifact, transition } = await executor.executeStep(step, 0, new AbortController())

    expect(transition).toBe('success')
    expect(artifact.success).toBe(true)
    expect(artifact.attempted_candidates?.length).toBe(2)
    expect(artifact.resolved_candidate?.value).toBe('[data-testid=good]')
  })

  it('navigates using step.value when action is navigate', async () => {
    const page = createMockPage()
    const executor = new BrowserToolExecutor(page as never, {
      maxRetries: 0,
    })

    const step: StepDsl = {
      step_id: 's1',
      action: 'navigate',
      target: {
        key: 'login_page',
        type: 'page',
      },
      value: 'https://example.com/from-step',
    }

    const { artifact, transition } = await executor.executeStep(step, 0, new AbortController())

    expect(transition).toBe('success')
    expect(artifact.success).toBe(true)
    expect(page.goto).toHaveBeenCalledWith(
      'https://example.com/from-step',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    )
  })

  it('fails navigate when step.value is missing and target has no url hints', async () => {
    const page = createMockPage()
    const executor = new BrowserToolExecutor(page as never, { maxRetries: 0 })

    const step: StepDsl = {
      step_id: 's1',
      action: 'navigate',
      target: {
        key: 'login_page',
        type: 'page',
      },
    }

    const { artifact, transition } = await executor.executeStep(step, 0, new AbortController())

    expect(transition).toBe('fail_fast')
    expect(artifact.success).toBe(false)
    expect(artifact.error).toContain('Unable to resolve URL')
  })

  it('uses role lookup for button label candidates', async () => {
    const firstFn = vi.fn().mockReturnThis()
    const roleLocator = {
      first: firstFn,
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      textContent: vi.fn().mockResolvedValue('Login'),
      boundingBox: vi.fn().mockResolvedValue({ x: 1, y: 1, width: 10, height: 10 }),
    }

    const page = {
      goto: vi.fn().mockResolvedValue({ status: () => 200 }),
      title: vi.fn().mockResolvedValue('Test Page'),
      url: vi.fn().mockReturnValue('https://example.com'),
      screenshot: vi.fn().mockResolvedValue(undefined),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      locator: vi.fn().mockImplementation((selector: string) => makeLocator(selector)),
      getByLabel: vi.fn().mockImplementation((label: string) => makeLocator(`[label:${label}]`)),
      getByRole: vi.fn().mockReturnValue(roleLocator),
      getByText: vi.fn().mockImplementation((text: string) => makeLocator(text)),
    }

    const resolver: ElementResolver = {
      async resolve() {
        return {
          candidates: [
            { id: 'c1', strategy: 'label', value: 'Login', score: 0.9 },
          ],
        }
      },
      locatorForCandidate(pageLike, _target, candidate) {
        return pageLike.locator(candidate.value).first()
      },
    }

    const executor = new BrowserToolExecutor(page as never, {
      resolver,
      maxRetries: 0,
    })

    const step: StepDsl = {
      step_id: 's1',
      action: 'click',
      target: { key: 'login_button', type: 'button', hints: ['Login'] },
      timeout_ms: 50,
    }

    const { artifact, transition } = await executor.executeStep(step, 0, new AbortController())

    expect(transition).toBe('success')
    expect(artifact.success).toBe(true)
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Login' })
    expect(page.getByLabel).not.toHaveBeenCalled()
  })

  it('waits for url_matches assertion within timeout', async () => {
    const page = createMockPage()
    page.url = vi.fn().mockReturnValue('https://example.com/bank/dashboard')

    const executor = new BrowserToolExecutor(page as never, { maxRetries: 0 })
    const step: StepDsl = {
      step_id: 's1',
      action: 'assert',
      target: { key: 'current_url', type: 'page' },
      assertions: [
        {
          type: 'url_matches',
          target: { key: 'current_url', type: 'page' },
          value: '/bank/dashboard',
        },
      ],
      timeout_ms: 50,
    }

    const { artifact, transition } = await executor.executeStep(step, 0, new AbortController())

    expect(transition).toBe('success')
    expect(artifact.success).toBe(true)
    expect((page.waitForURL as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })

  it('fails url_matches assertion when waitForURL times out', async () => {
    const page = createMockPage()
    page.waitForURL = vi.fn().mockRejectedValue(new Error('timeout'))
    page.url = vi.fn().mockReturnValue('https://example.com/bank')

    const executor = new BrowserToolExecutor(page as never, { maxRetries: 0 })
    const step: StepDsl = {
      step_id: 's1',
      action: 'assert',
      target: { key: 'current_url', type: 'page' },
      assertions: [
        {
          type: 'url_matches',
          target: { key: 'current_url', type: 'page' },
          value: '/bank/dashboard',
        },
      ],
      timeout_ms: 50,
    }

    const { artifact, transition } = await executor.executeStep(step, 0, new AbortController())

    expect(transition).toBe('fail_fast')
    expect(artifact.success).toBe(false)
    expect(artifact.error).toContain('/bank/dashboard')
  })
})
