/**
 * MacroExpander — expands high-level composite steps into atomic DSL steps.
 *
 * Examples:
 *   A single "fill" step with description containing "login" →
 *     navigate + fill(username) + fill(password) + click(submit) + screenshot
 *
 * Expansion is rule-based (pattern matching on step description + action).
 * After expansion the DSL is re-validated by DslValidator.
 */

import type { TestCaseDsl, StepDsl } from '../types/TestDsl.js'

type MacroRule = {
  /** Returns true if this rule should apply to the given step */
  matches(step: StepDsl, dsl: TestCaseDsl): boolean
  /** Returns the replacement steps (step_ids will be reassigned) */
  expand(step: StepDsl, dsl: TestCaseDsl): StepDsl[]
}

// ── Built-in macro rules ──────────────────────────────────────────────────────

const LOGIN_MACRO: MacroRule = {
  matches(step) {
    if (step.action !== 'fill') return false
    const desc = (step.description ?? '').toLowerCase()
    return desc.includes('login') || desc.includes('登录') || desc.includes('sign in')
  },
  expand(step, dsl) {
    return [
      {
        step_id: '__macro__',
        action: 'navigate',
        target: dsl.url,
        description: 'Navigate to login page',
      },
      {
        step_id: '__macro__',
        action: 'fill',
        target: step.target ?? 'input[type="text"], input[name="username"], #username',
        value: step.value,
        description: 'Fill username',
      },
      {
        step_id: '__macro__',
        action: 'fill',
        target: 'input[type="password"], input[name="password"], #password',
        value: '',
        description: 'Fill password (value unknown — check compile warnings)',
      },
      {
        step_id: '__macro__',
        action: 'click',
        target: 'button[type="submit"], button:has-text("Login"), button:has-text("登录")',
        description: 'Click submit / login button',
      },
    ]
  },
}

const REGISTERED_MACROS: MacroRule[] = [LOGIN_MACRO]

// ── Expander ──────────────────────────────────────────────────────────────────

export class MacroExpander {
  /** Expand any macro steps in the DSL. Returns a new DSL with reassigned step_ids. */
  expand(dsl: TestCaseDsl): { dsl: TestCaseDsl; expandedCount: number } {
    let expandedCount = 0
    const expandedSteps: StepDsl[] = []

    for (const step of dsl.steps) {
      const rule = REGISTERED_MACROS.find(r => r.matches(step, dsl))
      if (rule) {
        expandedSteps.push(...rule.expand(step, dsl))
        expandedCount++
      } else {
        expandedSteps.push(step)
      }
    }

    // Reassign step_ids sequentially
    const reindexed = expandedSteps.map((step, idx) => ({
      ...step,
      step_id: `s${idx + 1}`,
    }))

    return {
      dsl: { ...dsl, steps: reindexed },
      expandedCount,
    }
  }
}
