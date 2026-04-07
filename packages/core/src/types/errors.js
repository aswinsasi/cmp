"use strict";
/**
 * CMP Error Codes
 * Standardized error codes for failure reporting across all protocol layers.
 * Each error code has a defined recovery action.
 *
 * @module types/errors
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_RECOVERY = exports.ERROR_DESCRIPTIONS = exports.CMPErrorCode = void 0;
exports.errorDescription = errorDescription;
exports.errorRecovery = errorRecovery;
var CMPErrorCode;
(function (CMPErrorCode) {
    /** Chunk execution exceeded deadline */
    CMPErrorCode[CMPErrorCode["ERR_TIMEOUT"] = 1] = "ERR_TIMEOUT";
    /** Out of memory during WASM execution */
    CMPErrorCode[CMPErrorCode["ERR_OOM"] = 2] = "ERR_OOM";
    /** Code module hash verification failed */
    CMPErrorCode[CMPErrorCode["ERR_HASH_MISMATCH"] = 3] = "ERR_HASH_MISMATCH";
    /** Code attempted forbidden operation in sandbox */
    CMPErrorCode[CMPErrorCode["ERR_SANDBOX_VIOLATION"] = 4] = "ERR_SANDBOX_VIOLATION";
    /** Redundant executors produced different results */
    CMPErrorCode[CMPErrorCode["ERR_CONSENSUS_FAIL"] = 5] = "ERR_CONSENSUS_FAIL";
    /** Decryption or signature verification failure */
    CMPErrorCode[CMPErrorCode["ERR_CRYPTO_FAIL"] = 6] = "ERR_CRYPTO_FAIL";
    /** Executor overcommitted resources */
    CMPErrorCode[CMPErrorCode["ERR_CAPACITY"] = 7] = "ERR_CAPACITY";
    /** Executor departed during execution */
    CMPErrorCode[CMPErrorCode["ERR_DEPARTED"] = 8] = "ERR_DEPARTED";
    /** MER signature or format invalid */
    CMPErrorCode[CMPErrorCode["ERR_MER_INVALID"] = 9] = "ERR_MER_INVALID";
    /** Wire format or protocol sequence violation */
    CMPErrorCode[CMPErrorCode["ERR_PROTOCOL"] = 10] = "ERR_PROTOCOL";
})(CMPErrorCode || (exports.CMPErrorCode = CMPErrorCode = {}));
/** Human-readable error descriptions */
exports.ERROR_DESCRIPTIONS = {
    [CMPErrorCode.ERR_TIMEOUT]: 'Chunk execution exceeded deadline',
    [CMPErrorCode.ERR_OOM]: 'Out of memory during execution',
    [CMPErrorCode.ERR_HASH_MISMATCH]: 'Code module hash verification failed',
    [CMPErrorCode.ERR_SANDBOX_VIOLATION]: 'Code attempted forbidden sandbox operation',
    [CMPErrorCode.ERR_CONSENSUS_FAIL]: 'Redundant executors disagreed on result',
    [CMPErrorCode.ERR_CRYPTO_FAIL]: 'Decryption or verification failure',
    [CMPErrorCode.ERR_CAPACITY]: 'Executor overcommitted resources',
    [CMPErrorCode.ERR_DEPARTED]: 'Executor departed during execution',
    [CMPErrorCode.ERR_MER_INVALID]: 'MER signature or format invalid',
    [CMPErrorCode.ERR_PROTOCOL]: 'Wire format or sequence violation',
};
/** Recommended recovery action per error code */
exports.ERROR_RECOVERY = {
    [CMPErrorCode.ERR_TIMEOUT]: 'Reassign to faster device',
    [CMPErrorCode.ERR_OOM]: 'Reassign with smaller chunk',
    [CMPErrorCode.ERR_HASH_MISMATCH]: 'Re-transfer code module',
    [CMPErrorCode.ERR_SANDBOX_VIOLATION]: 'Reject code, reputation penalty',
    [CMPErrorCode.ERR_CONSENSUS_FAIL]: 'Re-execute with higher redundancy',
    [CMPErrorCode.ERR_CRYPTO_FAIL]: 'Re-key session, retry',
    [CMPErrorCode.ERR_CAPACITY]: 'Reassign to different executor',
    [CMPErrorCode.ERR_DEPARTED]: 'Use checkpoint or reassign',
    [CMPErrorCode.ERR_MER_INVALID]: 'Discard MER, penalize source',
    [CMPErrorCode.ERR_PROTOCOL]: 'Drop connection, re-handshake',
};
/**
 * Get error description by code.
 */
function errorDescription(code) {
    return exports.ERROR_DESCRIPTIONS[code] || `Unknown error code: 0x${code.toString(16).padStart(2, '0')}`;
}
/**
 * Get recovery suggestion by code.
 */
function errorRecovery(code) {
    return exports.ERROR_RECOVERY[code] || 'No recovery action defined';
}
//# sourceMappingURL=errors.js.map