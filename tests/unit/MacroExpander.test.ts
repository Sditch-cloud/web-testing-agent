import { describe, it, expect } from 'vitest'
import { MacroExpander } from '../../src/orchestrator/MacroExpander.js'
import type { TestCaseDsl } from '../../src/types/TestDsl.js'

const baseDsl: TestCaseDsl = {
  id: 'tc_test',
  name: 'Test',
  url: 'https://example.com',
  steps: [],
  compile_report: { confidence: 0.9, warnings: [], errors: [], source_nl: '', compiled_at: new Date().toISOString() },
}

describe('MacroExpander', () => {
  const expander = new MacroExpander()

  it('passes through non-macro steps unchanged', () => {
    const dsl: TestCaseDsl = {
      ...baseDsl,
      steps: [
        { step_id: 's1', action: 'navigate', target: { key: 'home', type: 'page', fallback: ['https://example.com'] }, value: 'https://example.com' },
        { step_id: 's2', action: 'screenshot', target: { key: 'home', type: 'page' } },
      ],
    }
    const { dsl: expanded, expandedCount } = expander.expand(dsl)
    expect(expandedCount).toBe(0)
    expect(expanded.steps).toHaveLength(2)
    expect(expanded.steps[0]!.step_id).toBe('s1')
    expect(expanded.steps[1]!.step_id).toBe('s2')
  })

  it('expands a fill step with login description into atomic steps', () => {
    const dsl: TestCaseDsl = {
      ...baseDsl,
      steps: [
        { step_id: 's1', action: 'input', target: { key: 'username', type: 'input', hints: ['Username'] }, value: 'admin', description: 'Login to the app' },
      ],
    }
    const { dsl: expanded, expandedCount } = expander.expand(dsl)
    expect(expandedCount).toBe(1)
    expect(expanded.steps.length).toBeGreaterThan(1)
    // Check step_ids are reassigned sequentially
    expanded.steps.forEach((step, i) => {
      expect(step.step_id).toBe(`s${i + 1}`)
    })
    // Check it includes navigate, fill, click actions
    const actions = expanded.steps.map(s => s.action)
    expect(actions).toContain('navigate')
    expect(actions).toContain('input')
    expect(actions).toContain('click')
  })
})
