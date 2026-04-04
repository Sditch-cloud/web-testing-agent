import { describe, it, expect } from 'vitest'
import { DslValidator } from '../../src/orchestrator/DslValidator.js'
import type { TestCaseDsl } from '../../src/types/TestDsl.js'

const validDsl: TestCaseDsl = {
  id: 'tc_test',
  name: 'Login Test',
  url: 'https://example.com/login',
  steps: [
    { step_id: 's1', action: 'navigate', target: 'https://example.com/login', description: 'Open login page' },
    { step_id: 's2', action: 'fill', target: '#username', value: 'admin', description: 'Fill username' },
    { step_id: 's3', action: 'fill', target: '#password', value: 'secret', description: 'Fill password' },
    { step_id: 's4', action: 'click', target: 'button[type="submit"]', description: 'Submit form' },
    { step_id: 's5', action: 'assert', target: 'body', assertions: [{ type: 'text_contains', target: 'body', value: 'Welcome' }], description: 'Check welcome message' },
    { step_id: 's6', action: 'screenshot', description: 'Final screenshot' },
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

  it('rejects navigate step without target', () => {
    const steps = [{ step_id: 's1', action: 'navigate' as const }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_TARGET')).toBe(true)
  })

  it('rejects click step without target', () => {
    const steps = [{ step_id: 's1', action: 'click' as const }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_TARGET')).toBe(true)
  })

  it('rejects assert step without assertions', () => {
    const steps = [{ step_id: 's1', action: 'assert' as const, target: 'body', assertions: [] }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_ASSERTIONS')).toBe(true)
  })

  it('rejects assert step with text_contains but no value', () => {
    const steps = [{ step_id: 's1', action: 'assert' as const, target: 'body', assertions: [{ type: 'text_contains' as const, target: 'body' }] }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'MISSING_ASSERTION_VALUE')).toBe(true)
  })

  it('rejects unknown action type', () => {
    const steps = [{ step_id: 's1', action: 'hover' as never, target: '#btn' }]
    const result = validator.validate({ ...validDsl, steps })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'INVALID_ACTION')).toBe(true)
  })
})
