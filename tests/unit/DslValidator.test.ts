import { describe, it, expect } from 'vitest'
import { DslValidator } from '../../src/orchestrator/DslValidator.js'
import type { TestCaseDsl } from '../../src/types/TestDsl.js'

const validDsl: TestCaseDsl = {
  id: 'tc_test',
  name: 'Login Test',
  url: 'https://example.com/login',
  steps: [
    { step_id: 's1', action: 'navigate', target: { key: 'login_page', type: 'page', hints: ['Login Page'], fallback: ['https://example.com/login'] }, value: 'https://example.com/login', description: 'Open login page' },
    { step_id: 's2', action: 'input', target: { key: 'username', type: 'input', hints: ['Username', 'Email'] }, value: 'admin', description: 'Fill username' },
    { step_id: 's3', action: 'input', target: { key: 'password', type: 'input', hints: ['Password'] }, value: 'secret', description: 'Fill password' },
    { step_id: 's4', action: 'click', target: { key: 'login_submit', type: 'button', hints: ['Login', 'Sign In'] }, description: 'Submit form' },
    { step_id: 's5', action: 'assert', target: { key: 'welcome_area', type: 'text', hints: ['Welcome'] }, assertions: [{ type: 'text_contains', target: { key: 'welcome_area', type: 'text', hints: ['Welcome'] }, value: 'Welcome' }], description: 'Check welcome message' },
    { step_id: 's6', action: 'screenshot', target: { key: 'final_page', type: 'page' }, description: 'Final screenshot' },
  ],
  compile_report: { confidence: 0.95, warnings: [], errors: [], source_nl: 'Login test', compiled_at: new Date().toISOString() },
}

describe('DslValidator', () => {
  const validator = new DslValidator()

  it('validates a correct DSL without errors', () => {
    const result = validator.validate(validDsl)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects DSL with missing id', () => {
    const result = validator.validate({ ...validDsl, id: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_ID')).toBe(true)
  })

  it('rejects DSL with invalid URL', () => {
    const result = validator.validate({ ...validDsl, url: 'not-a-url' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'INVALID_URL')).toBe(true)
  })

  it('rejects empty steps array', () => {
    const result = validator.validate({ ...validDsl, steps: [] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'EMPTY_STEPS')).toBe(true)
  })

  it('rejects duplicate step_ids', () => {
    const steps = [...validDsl.steps, { ...validDsl.steps[0]!, step_id: 's1' }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'DUPLICATE_STEP_ID')).toBe(true)
  })

  it('rejects step with string target', () => {
    const steps = [{ step_id: 's1', action: 'click' as const, target: '#username' as never }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_TARGET_KEY')).toBe(true)
  })

  it('rejects step with missing target.key', () => {
    const steps = [{ step_id: 's1', action: 'click' as const, target: { key: '', type: 'button' as const } }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_TARGET_KEY')).toBe(true)
  })

  it('rejects assert step without assertions', () => {
    const steps = [{ step_id: 's1', action: 'assert' as const, target: { key: 'body', type: 'text' as const }, assertions: [] }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_ASSERTIONS')).toBe(true)
  })

  it('rejects assert step with text_contains but no value', () => {
    const steps = [{ step_id: 's1', action: 'assert' as const, target: { key: 'body', type: 'text' as const }, assertions: [{ type: 'text_contains' as const, target: { key: 'body', type: 'text' as const } }] }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_ASSERTION_VALUE')).toBe(true)
  })

  it('rejects unknown action type', () => {
    const steps = [{ step_id: 's1', action: 'hover' as never, target: { key: 'btn', type: 'button' as const } }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'INVALID_ACTION')).toBe(true)
  })

  it('normalizes hints to string[]', () => {
    const normalized = validator.normalize({
      ...validDsl,
      steps: [{ step_id: 's1', action: 'click', target: { key: 'submit', type: 'button', hints: [' Login ', 'Login', ''] } }],
    })
    expect(normalized.steps[0]!.target.hints).toEqual(['Login'])
  })

  it('rejects navigate without step.value even when top-level dsl.url is valid', () => {
    const steps = [{ step_id: 's1', action: 'navigate' as const, target: { key: 'login_page', type: 'page' as const } }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_NAVIGATE_URL')).toBe(true)
  })

  it('accepts navigate when step.value is an absolute URL', () => {
    const steps = [{ step_id: 's1', action: 'navigate' as const, target: { key: 'login_page', type: 'page' as const }, value: 'https://example.com/login' }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(true)
    expect(result.errors.some(e => e.code === 'MISSING_NAVIGATE_URL')).toBe(false)
  })
})
