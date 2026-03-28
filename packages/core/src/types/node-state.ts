/**
 * CMP Node State Machine
 * Formalizes the node lifecycle states and valid transitions.
 *
 * States: IDLE → DISCOVERING → JOINING → ACTIVE → DEPARTING → IDLE
 *
 * Every CMP node MUST implement this state machine. Invalid
 * transitions indicate a protocol bug and MUST be logged.
 *
 * @module types/node-state
 * @author Agent Viscro
 */

export enum NodeState {
  /** Not participating in any mesh. Beacons stopped. */
  IDLE = 'IDLE',
  /** Broadcasting beacons, listening for peers. */
  DISCOVERING = 'DISCOVERING',
  /** ECDH handshake in progress. Capability exchange. */
  JOINING = 'JOINING',
  /** Full mesh participant. Can request/execute tasks. */
  ACTIVE = 'ACTIVE',
  /** DEPARTURE_NOTICE sent. Chunk/MER handoff in progress. */
  DEPARTING = 'DEPARTING',
}

/** Valid state transitions */
const VALID_TRANSITIONS: Record<NodeState, NodeState[]> = {
  [NodeState.IDLE]: [NodeState.DISCOVERING],
  [NodeState.DISCOVERING]: [NodeState.JOINING, NodeState.IDLE],
  [NodeState.JOINING]: [NodeState.ACTIVE, NodeState.DISCOVERING],
  [NodeState.ACTIVE]: [NodeState.DEPARTING, NodeState.DISCOVERING],
  [NodeState.DEPARTING]: [NodeState.IDLE],
};

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: NodeState, to: NodeState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Get all valid transitions from a given state.
 */
export function validTransitionsFrom(state: NodeState): NodeState[] {
  return VALID_TRANSITIONS[state] || [];
}

/**
 * Get all states in the state machine.
 */
export function allStates(): NodeState[] {
  return Object.values(NodeState);
}

/**
 * Get all valid transitions as pairs [from, to].
 */
export function allTransitions(): [NodeState, NodeState][] {
  const result: [NodeState, NodeState][] = [];
  for (const from of allStates()) {
    for (const to of validTransitionsFrom(from)) {
      result.push([from, to]);
    }
  }
  return result;
}
