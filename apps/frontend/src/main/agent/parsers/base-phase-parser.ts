/**
 * Base Phase Parser
 * ==================
 * Abstract base class for phase parsing with regression prevention.
 * Provides common functionality for all phase parsers.
 */

/**
 * Result of parsing a phase event.
 * Generic over the phase type for type safety.
 */
export interface PhaseParseResult<TPhase extends string = string> {
  phase: TPhase;
  message?: string;
  currentSubtask?: string;
  progress?: number;
  // Pause phase metadata
  resetTimestamp?: number;  // Unix timestamp for rate limit reset
  profileId?: string;  // Profile that hit the limit
}

/**
 * Context for phase parsing decisions.
 * Provides current state information to the parser.
 */
export interface PhaseParserContext<TPhase extends string = string> {
  currentPhase: TPhase;
  isTerminal: boolean;
}

/**
 * Abstract base class for phase parsers.
 * Implements regression prevention and terminal state checking.
 *
 * @template TPhase - The union type of valid phases
 */
export abstract class BasePhaseParser<TPhase extends string> {
  /**
   * Ordered array of phases for regression detection.
   * Index determines progression order.
   */
  protected abstract readonly phaseOrder: readonly TPhase[];

  /**
   * Set of terminal phases that cannot be changed by fallback matching.
   */
  protected abstract readonly terminalPhases: ReadonlySet<TPhase>;

  /**
   * Check if transitioning to a new phase would be a regression.
   *
   * @param currentPhase - The current phase
   * @param newPhase - The proposed new phase
   * @returns true if the transition would go backwards
   */
  protected wouldRegress(currentPhase: TPhase, newPhase: TPhase): boolean {
    const currentIdx = this.phaseOrder.indexOf(currentPhase);
    const newIdx = this.phaseOrder.indexOf(newPhase);
    // Only regress if both phases are in the order array and new is before current
    return currentIdx >= 0 && newIdx >= 0 && newIdx < currentIdx;
  }

  /**
   * Check if a phase is a terminal state.
   *
   * @param phase - The phase to check
   * @returns true if the phase is terminal
   */
  protected isTerminal(phase: TPhase): boolean {
    return this.terminalPhases.has(phase);
  }

  /**
   * Parse a log line and extract phase information.
   *
   * @param log - The log line to parse
   * @param context - Current parsing context
   * @returns Parsed phase result, or null if no phase detected
   */
  abstract parse(log: string, context: PhaseParserContext<TPhase>): PhaseParseResult<TPhase> | null;
}
