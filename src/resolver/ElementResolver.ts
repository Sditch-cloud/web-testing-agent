import type { Locator, Page } from 'playwright'
import type { ActionType, TargetDsl } from '../types/TestDsl.js'
import type { Candidate, ElementResolver, ResolveResult, ResolverMemory, ResolutionContext } from './types.js'

type SupportedRole = 'textbox' | 'button' | 'link'

const TARGET_ROLE_MAP: Record<TargetDsl['type'], SupportedRole | null> = {
  input: 'textbox',
  button: 'button',
  link: 'link',
  page: null,
  text: null,
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>()
  const result: Candidate[] = []
  for (const candidate of candidates) {
    const key = `${candidate.strategy}:${candidate.value}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }
  return result
}

function toCandidate(strategy: Candidate['strategy'], value: string, score: number): Candidate {
  return {
    id: `${strategy}:${value}`,
    strategy,
    value,
    score,
  }
}

export class PlaywrightElementResolver implements ElementResolver {
  constructor(private readonly memory?: ResolverMemory) {}

  async resolve(_page: Page, target: TargetDsl, context: ResolutionContext): Promise<ResolveResult> {
    const k = context.k ?? 3
    const hints = target.hints ?? []
    const fallback = target.fallback ?? []

    const memoryCandidates = this.memory
      ? await this.memory.getCandidates(target.key, context.action)
      : []

    const semanticCandidates: Candidate[] = [
      toCandidate('role', target.key, 0.88),
      toCandidate('text', target.key, 0.8),
      ...hints.flatMap((hint, idx) => [
        toCandidate('label', hint, 0.84 - idx * 0.02),
        toCandidate('role', hint, 0.82 - idx * 0.02),
        toCandidate('text', hint, 0.78 - idx * 0.02),
      ]),
      ...fallback.map((value, idx) => toCandidate('fallback', value, 0.6 - idx * 0.01)),
    ]

    const ranked = uniqueCandidates([...memoryCandidates, ...semanticCandidates])
      .sort((a, b) => b.score - a.score)
      .slice(0, k)

    return { candidates: ranked }
  }

  locatorForCandidate(page: Page, target: TargetDsl, candidate: Candidate): Locator {
    const role = TARGET_ROLE_MAP[target.type]

    switch (candidate.strategy) {
      case 'memory':
      case 'fallback':
        return page.locator(candidate.value).first()
      case 'label':
        return page.getByLabel(candidate.value).first()
      case 'role':
        if (role) {
          return page.getByRole(role, { name: candidate.value }).first()
        }
        return page.getByText(candidate.value).first()
      case 'text':
        return page.getByText(candidate.value).first()
      default:
        return page.locator(candidate.value).first()
    }
  }
}

export function inferUrlFromTarget(stepValue: string | undefined, target: TargetDsl): string {
  if (stepValue && /^https?:\/\//.test(stepValue)) return stepValue
  if (/^https?:\/\//.test(target.key)) return target.key
  const fallbackUrl = (target.fallback ?? []).find(item => /^https?:\/\//.test(item))
  if (fallbackUrl) return fallbackUrl
  throw new Error(`Unable to resolve URL for target key: ${target.key}`)
}

export function resolvePressKey(stepValue: string | undefined, target: TargetDsl): string {
  if (stepValue && stepValue.trim() !== '') return stepValue.trim()
  if (target.key.trim() !== '') return target.key.trim()
  return 'Enter'
}

export function isResolverAction(action: ActionType): boolean {
  return action === 'click' || action === 'input' || action === 'assert'
}
