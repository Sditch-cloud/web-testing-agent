/**
 * LLM message types used in the NL→DSL compilation phase.
 * Modeled after the claude-code reference message types but simplified
 * for the OpenAI API interface.
 */

export type Role = 'system' | 'user' | 'assistant'

export type Message = {
  role: Role
  content: string
}

export type CompilationRequest = {
  /** Natural language test case description */
  nl_input: string
  /** Additional context hints (e.g. known labels, semantic keys, base URL) */
  hints?: string[]
}

export type CompilationResponse = {
  /** Raw JSON string returned by the LLM before parsing */
  raw_json: string
  /** Number of tokens used (for budget tracking) */
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
