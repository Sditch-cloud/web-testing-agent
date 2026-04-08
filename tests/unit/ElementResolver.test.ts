import { describe, it, expect } from 'vitest'
import { PlaywrightElementResolver } from '../../src/resolver/ElementResolver.js'
import type { Candidate, ResolverMemory } from '../../src/resolver/types.js'

describe('PlaywrightElementResolver', () => {
  it('returns Top-K candidates sorted by score', async () => {
    const resolver = new PlaywrightElementResolver()
    const result = await resolver.resolve(
      {} as never,
      {
        key: 'username',
        type: 'input',
        hints: ['Username', 'Email'],
        fallback: ['#username'],
      },
      { action: 'input', k: 3 },
    )

    expect(result.candidates).toHaveLength(3)
    expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(result.candidates[1]!.score)
    expect(result.candidates[1]!.score).toBeGreaterThanOrEqual(result.candidates[2]!.score)
  })

  it('prioritizes resolver memory candidates', async () => {
    const memory: ResolverMemory = {
      async getCandidates(): Promise<Candidate[]> {
        return [{ id: 'm1', strategy: 'memory', value: 'button[data-test=login]', score: 0.99 }]
      },
      async recordSuccess(): Promise<void> {
        return
      },
    }

    const resolver = new PlaywrightElementResolver(memory)
    const result = await resolver.resolve(
      {} as never,
      {
        key: 'login_submit',
        type: 'button',
        hints: ['Login'],
      },
      { action: 'click', k: 3 },
    )

    expect(result.candidates[0]!.strategy).toBe('memory')
    expect(result.candidates[0]!.value).toBe('button[data-test=login]')
  })
})
