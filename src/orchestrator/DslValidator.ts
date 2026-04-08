/**
 * DslValidator — validates a compiled TestCaseDsl for correctness.
 *
 * Checks:
 * - Field completeness (required fields present)
 * - Step executability (actions have required targets/values)
 * - Assertion legality (assertion types have required operands)
 * - Step ID uniqueness
 */

import type {
  TestCaseDsl,
  StepDsl,
  TargetDsl,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from '../types/TestDsl.js'

const VALID_ACTIONS = new Set(['input', 'click', 'press', 'navigate', 'screenshot', 'assert'])
const VALID_TARGET_TYPES = new Set(['input', 'button', 'link', 'page', 'text'])
const VALID_ASSERTION_TYPES = new Set(['text_contains', 'url_matches', 'element_visible', 'element_not_visible'])
const ASSERTIONS_REQUIRING_VALUE = new Set(['text_contains', 'url_matches'])

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
  return [...new Set(normalized)]
}

function normalizeTarget(target: unknown): TargetDsl {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return {
      key: '',
      type: 'text',
    }
  }

  const typed = target as Partial<TargetDsl>
  const rawKey = typeof typed.key === 'string' ? typed.key : ''
  const rawType = typeof typed.type === 'string' ? typed.type : 'text'
  const normalizedHints = normalizeStringArray(typed.hints)
  const normalizedFallback = normalizeStringArray(typed.fallback)

  return {
    key: rawKey.trim(),
    type: rawType as TargetDsl['type'],
    ...(normalizedHints.length > 0 ? { hints: normalizedHints } : {}),
    ...(normalizedFallback.length > 0 ? { fallback: normalizedFallback } : {}),
  }
}

export class DslValidator {
  normalize(dsl: TestCaseDsl): TestCaseDsl {
    return {
      ...dsl,
      steps: dsl.steps.map(step => ({
        ...step,
        action: step.action,
        target: normalizeTarget(step.target),
        assertions: step.assertions?.map(assertion => ({
          ...assertion,
          target: normalizeTarget(assertion.target),
          ...(typeof assertion.value === 'string' ? { value: assertion.value.trim() } : {}),
        })),
      })),
    }
  }

  validate(dsl: TestCaseDsl): ValidationResult {
    const normalizedDsl = this.normalize(dsl)
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Top-level checks
    if (!normalizedDsl.id || normalizedDsl.id.trim() === '') {
      errors.push({ code: 'MISSING_ID', message: 'TestCaseDsl is missing required field: id' })
    }
    if (!normalizedDsl.name || normalizedDsl.name.trim() === '') {
      errors.push({ code: 'MISSING_NAME', message: 'TestCaseDsl is missing required field: name' })
    }
    if (!normalizedDsl.url || normalizedDsl.url.trim() === '') {
      errors.push({ code: 'MISSING_URL', message: 'TestCaseDsl is missing required field: url' })
    } else if (!normalizedDsl.url.startsWith('http://') && !normalizedDsl.url.startsWith('https://')) {
      errors.push({ code: 'INVALID_URL', message: `TestCaseDsl url must start with http:// or https://, got: ${normalizedDsl.url}` })
    }
    if (!Array.isArray(normalizedDsl.steps) || normalizedDsl.steps.length === 0) {
      errors.push({ code: 'EMPTY_STEPS', message: 'TestCaseDsl must have at least one step' })
      return { valid: false, errors, warnings }
    }

    // Step-level checks
    const seenStepIds = new Set<string>()
    for (const step of normalizedDsl.steps) {
      this.validateStep(step, seenStepIds, errors, warnings)
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  private validateStep(
    step: StepDsl,
    seenStepIds: Set<string>,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    const ctx = { step_id: step.step_id }

    // step_id presence and uniqueness
    if (!step.step_id || step.step_id.trim() === '') {
      errors.push({ ...ctx, code: 'MISSING_STEP_ID', message: 'Step is missing required field: step_id' })
    } else if (seenStepIds.has(step.step_id)) {
      errors.push({ ...ctx, code: 'DUPLICATE_STEP_ID', message: `Duplicate step_id: ${step.step_id}` })
    } else {
      seenStepIds.add(step.step_id)
    }

    // action validity
    if (!step.action) {
      errors.push({ ...ctx, field: 'action', code: 'MISSING_ACTION', message: `Step ${step.step_id} is missing required field: action` })
      return
    }
    if (!VALID_ACTIONS.has(step.action)) {
      errors.push({ ...ctx, field: 'action', code: 'INVALID_ACTION', message: `Step ${step.step_id} has unknown action: ${step.action}. Valid: ${[...VALID_ACTIONS].join(', ')}` })
      return
    }

    // target must always be a semantic object
    this.validateTarget(step.target, ctx.step_id, 'target', errors, warnings)

    // input requires value
    if (step.action === 'input' && (step.value === undefined || step.value === '')) {
      warnings.push({ ...ctx, field: 'value', code: 'MISSING_INPUT_VALUE', message: `Step ${step.step_id} (input) has no value — will fill with empty string` })
    }

    // press requires key value
    if (step.action === 'press' && (!step.value || step.value.trim() === '')) {
      errors.push({ ...ctx, field: 'value', code: 'MISSING_PRESS_VALUE', message: `Step ${step.step_id} (press) requires a keyboard key value` })
    }

    // assert requires assertions array
    if (step.action === 'assert') {
      if (!Array.isArray(step.assertions) || step.assertions.length === 0) {
        errors.push({ ...ctx, field: 'assertions', code: 'MISSING_ASSERTIONS', message: `Step ${step.step_id} (assert) must have at least one assertion` })
      } else {
        for (const assertion of step.assertions) {
          if (!assertion.type || !VALID_ASSERTION_TYPES.has(assertion.type)) {
            errors.push({ ...ctx, field: 'assertions', code: 'INVALID_ASSERTION_TYPE', message: `Step ${step.step_id} has unknown assertion type: ${assertion.type}` })
          }
          this.validateTarget(assertion.target, ctx.step_id, 'assertions.target', errors, warnings)
          if (ASSERTIONS_REQUIRING_VALUE.has(assertion.type) && (!assertion.value || assertion.value.trim() === '')) {
            errors.push({ ...ctx, field: 'assertions', code: 'MISSING_ASSERTION_VALUE', message: `Step ${step.step_id} assertion (${assertion.type}) requires a value` })
          }
        }
      }
    }

    // timeout sanity
    if (step.timeout_ms !== undefined && (step.timeout_ms <= 0 || step.timeout_ms > 300_000)) {
      warnings.push({ ...ctx, field: 'timeout_ms', code: 'SUSPECT_TIMEOUT', message: `Step ${step.step_id} timeout_ms=${step.timeout_ms} is outside expected range (0–300000ms)` })
    }
  }

  private validateTarget(
    target: unknown,
    stepId: string,
    field: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    const ctx = { step_id: stepId, field }
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      errors.push({ ...ctx, code: 'INVALID_TARGET', message: `Step ${stepId} must provide target as an object` })
      return
    }

    const typedTarget = target as Partial<TargetDsl>
    if (!typedTarget.key || typedTarget.key.trim() === '') {
      errors.push({ ...ctx, code: 'MISSING_TARGET_KEY', message: `Step ${stepId} target.key is required` })
    }

    if (!typedTarget.type) {
      errors.push({ ...ctx, code: 'MISSING_TARGET_TYPE', message: `Step ${stepId} target.type is required` })
    } else if (!VALID_TARGET_TYPES.has(typedTarget.type)) {
      errors.push({ ...ctx, code: 'INVALID_TARGET_TYPE', message: `Step ${stepId} target.type must be one of: ${[...VALID_TARGET_TYPES].join(', ')}` })
    }

    if (typedTarget.hints !== undefined && !Array.isArray(typedTarget.hints)) {
      warnings.push({ ...ctx, code: 'INVALID_HINTS_FORMAT', message: `Step ${stepId} target.hints should be string[] and will be normalized` })
    }

    if (typedTarget.fallback !== undefined && !Array.isArray(typedTarget.fallback)) {
      warnings.push({ ...ctx, code: 'INVALID_FALLBACK_FORMAT', message: `Step ${stepId} target.fallback should be string[] and will be normalized` })
    }
  }
}
