/**
 * DslValidator — validates a compiled TestCaseDsl for correctness.
 *
 * Checks:
 * - Field completeness (required fields present)
 * - Step executability (actions have required targets/values)
 * - Assertion legality (assertion types have required operands)
 * - Step ID uniqueness
 */

import type { TestCaseDsl, StepDsl, ValidationResult, ValidationError, ValidationWarning } from '../types/TestDsl.js'

const VALID_ACTIONS = new Set(['navigate', 'click', 'fill', 'screenshot', 'assert'])
const VALID_ASSERTION_TYPES = new Set(['text_contains', 'url_matches', 'element_visible', 'element_not_visible'])
const ACTIONS_REQUIRING_TARGET = new Set(['navigate', 'click', 'fill', 'assert'])
const ASSERTIONS_REQUIRING_VALUE = new Set(['text_contains', 'url_matches'])

export class DslValidator {
  validate(dsl: TestCaseDsl): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Top-level checks
    if (!dsl.id || dsl.id.trim() === '') {
      errors.push({ code: 'MISSING_ID', message: 'TestCaseDsl is missing required field: id' })
    }
    if (!dsl.name || dsl.name.trim() === '') {
      errors.push({ code: 'MISSING_NAME', message: 'TestCaseDsl is missing required field: name' })
    }
    if (!dsl.url || dsl.url.trim() === '') {
      errors.push({ code: 'MISSING_URL', message: 'TestCaseDsl is missing required field: url' })
    } else if (!dsl.url.startsWith('http://') && !dsl.url.startsWith('https://')) {
      errors.push({ code: 'INVALID_URL', message: `TestCaseDsl url must start with http:// or https://, got: ${dsl.url}` })
    }
    if (!Array.isArray(dsl.steps) || dsl.steps.length === 0) {
      errors.push({ code: 'EMPTY_STEPS', message: 'TestCaseDsl must have at least one step' })
      return { valid: false, errors, warnings }
    }

    // Step-level checks
    const seenStepIds = new Set<string>()
    for (const step of dsl.steps) {
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

    // target requirement by action
    if (ACTIONS_REQUIRING_TARGET.has(step.action) && (!step.target || step.target.trim() === '')) {
      errors.push({ ...ctx, field: 'target', code: 'MISSING_TARGET', message: `Step ${step.step_id} (${step.action}) requires a target` })
    }

    // fill requires value
    if (step.action === 'fill' && (step.value === undefined || step.value === '')) {
      warnings.push({ ...ctx, field: 'value', code: 'MISSING_FILL_VALUE', message: `Step ${step.step_id} (fill) has no value — will fill with empty string` })
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
          if (!assertion.target || assertion.target.trim() === '') {
            errors.push({ ...ctx, field: 'assertions', code: 'MISSING_ASSERTION_TARGET', message: `Step ${step.step_id} assertion is missing target` })
          }
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
}
