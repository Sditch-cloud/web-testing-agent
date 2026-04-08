import type { Page, Locator } from 'playwright'
import type { ActionType, TargetDsl } from '../types/TestDsl.js'

export type CandidateStrategy = 'memory' | 'label' | 'role' | 'text' | 'fallback'

export type Candidate = {
  id: string
  strategy: CandidateStrategy
  value: string
  score: number
}

export type ResolutionContext = {
  action: ActionType
  k?: number
}

export type ResolverMemory = {
  getCandidates(targetKey: string, action: ActionType): Promise<Candidate[]>
  recordSuccess(targetKey: string, action: ActionType, candidate: Candidate): Promise<void>
}

export type ResolveResult = {
  candidates: Candidate[]
}

export interface ElementResolver {
  resolve(page: Page, target: TargetDsl, context: ResolutionContext): Promise<ResolveResult>
  locatorForCandidate(page: Page, target: TargetDsl, candidate: Candidate): Locator
}
