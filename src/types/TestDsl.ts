/**
 * Core DSL types for the Web Testing Agent.
 *
 * A TestCaseDsl is the compiled, structured representation of a natural language
 * test case. It is produced by TestCaseCompiler and validated by DslValidator.
 */

// ── Action vocabulary ─────────────────────────────────────────────────────────

export type ActionType = 'input' | 'click' | 'press' | 'navigate' | 'screenshot' | 'assert'

export type TargetType = 'input' | 'button' | 'link' | 'page' | 'text'

export type TargetDsl = {
  /** Stable semantic key (e.g. "username", "login_button") */
  key: string
  /** Semantic element type used by resolver strategy */
  type: TargetType
  /** Human hints used by resolver (label/text/placeholder) */
  hints?: string[]
  /** Optional resolver-level fallback expressions (never a primary target) */
  fallback?: string[]
}

// ── Assertion types ───────────────────────────────────────────────────────────

export type AssertionType = 'text_contains' | 'url_matches' | 'element_visible' | 'element_not_visible'

export type AssertionDsl = {
  /** What to assert */
  type: AssertionType
  /** Semantic target descriptor for assertion scope */
  target: TargetDsl
  /** Expected value (required for text_contains and url_matches) */
  value?: string
}

// ── Step DSL ──────────────────────────────────────────────────────────────────

export type StepDsl = {
  /** Unique identifier within the test case (e.g. "s1", "s2") */
  step_id: string
  /** The action to perform */
  action: ActionType
  /** Semantic target descriptor */
  target: TargetDsl
  /** Value to input/press/compare depending on action */
  value?: string
  /** Assertions to verify after the action (for assert action) */
  assertions?: AssertionDsl[]
  /** Per-step timeout in milliseconds (overrides default) */
  timeout_ms?: number
  /** Human-readable description of what this step does */
  description?: string
}

// ── Compile report ────────────────────────────────────────────────────────────

export type CompileWarning = {
  step_id?: string
  code: string
  message: string
}

export type CompileError = {
  step_id?: string
  code: string
  message: string
}

export type CompileReport = {
  /** Overall confidence of the compilation (0–1) */
  confidence: number
  /** Non-fatal issues that were auto-resolved or ambiguous */
  warnings: CompileWarning[]
  /** Fatal issues that prevent compilation */
  errors: CompileError[]
  /** Original natural language input */
  source_nl: string
  /** ISO timestamp of when compilation was performed */
  compiled_at: string
}

// ── Test case DSL ─────────────────────────────────────────────────────────────

export type TestCaseDsl = {
  /** Unique test case ID (e.g. "tc_abc123") */
  id: string
  /** Human-readable test name */
  name: string
  /** Starting URL for the test */
  url: string
  /** Ordered list of test steps */
  steps: StepDsl[]
  /** Report from the NL→DSL compilation phase */
  compile_report: CompileReport
}

// ── Validation types ──────────────────────────────────────────────────────────

export type ValidationError = {
  step_id?: string
  field?: string
  code: string
  message: string
}

export type ValidationWarning = {
  step_id?: string
  field?: string
  code: string
  message: string
}

export type ValidationResult = {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}
