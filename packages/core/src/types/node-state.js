"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeState = void 0;
exports.isValidTransition = isValidTransition;
exports.validTransitionsFrom = validTransitionsFrom;
exports.allStates = allStates;
exports.allTransitions = allTransitions;
var NodeState;
(function (NodeState) {
    /** Not participating in any mesh. Beacons stopped. */
    NodeState["IDLE"] = "IDLE";
    /** Broadcasting beacons, listening for peers. */
    NodeState["DISCOVERING"] = "DISCOVERING";
    /** ECDH handshake in progress. Capability exchange. */
    NodeState["JOINING"] = "JOINING";
    /** Full mesh participant. Can request/execute tasks. */
    NodeState["ACTIVE"] = "ACTIVE";
    /** DEPARTURE_NOTICE sent. Chunk/MER handoff in progress. */
    NodeState["DEPARTING"] = "DEPARTING";
})(NodeState || (exports.NodeState = NodeState = {}));
/** Valid state transitions */
const VALID_TRANSITIONS = {
    [NodeState.IDLE]: [NodeState.DISCOVERING],
    [NodeState.DISCOVERING]: [NodeState.JOINING, NodeState.IDLE],
    [NodeState.JOINING]: [NodeState.ACTIVE, NodeState.DISCOVERING],
    [NodeState.ACTIVE]: [NodeState.DEPARTING, NodeState.DISCOVERING],
    [NodeState.DEPARTING]: [NodeState.IDLE],
};
/**
 * Check if a state transition is valid.
 */
function isValidTransition(from, to) {
    const allowed = VALID_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
}
/**
 * Get all valid transitions from a given state.
 */
function validTransitionsFrom(state) {
    return VALID_TRANSITIONS[state] || [];
}
/**
 * Get all states in the state machine.
 */
function allStates() {
    return Object.values(NodeState);
}
/**
 * Get all valid transitions as pairs [from, to].
 */
function allTransitions() {
    const result = [];
    for (const from of allStates()) {
        for (const to of validTransitionsFrom(from)) {
            result.push([from, to]);
        }
    }
    return result;
}
//# sourceMappingURL=node-state.js.map