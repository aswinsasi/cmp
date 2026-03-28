/**
 * CMP Error Codes
 * Standardized error codes for failure reporting across all protocol layers.
 * Each error code has a defined recovery action.
 *
 * @module types/errors
 * @author Agent Viscro
 */

export enum CMPErrorCode {
  /** Chunk execution exceeded deadline */
  ERR_TIMEOUT = 0x01,
  /** Out of memory during WASM execution */
  ERR_OOM = 0x02,
  /** Code module hash verification failed */
  ERR_HASH_MISMATCH = 0x03,
  /** Code attempted forbidden operation in sandbox */
  ERR_SANDBOX_VIOLATION = 0x04,
  /** Redundant executors produced different results */
  ERR_CONSENSUS_FAIL = 0x05,
  /** Decryption or signature verification failure */
  ERR_CRYPTO_FAIL = 0x06,
  /** Executor overcommitted resources */
  ERR_CAPACITY = 0x07,
  /** Executor departed during execution */
  ERR_DEPARTED = 0x08,
  /** MER signature or format invalid */
  ERR_MER_INVALID = 0x09,
  /** Wire format or protocol sequence violation */
  ERR_PROTOCOL = 0x0A,
}

/** Human-readable error descriptions */
export const ERROR_DESCRIPTIONS: Record<CMPErrorCode, string> = {
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
export const ERROR_RECOVERY: Record<CMPErrorCode, string> = {
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
export function errorDescription(code: CMPErrorCode): string {
  return ERROR_DESCRIPTIONS[code] || `Unknown error code: 0x${code.toString(16).padStart(2, '0')}`;
}

/**
 * Get recovery suggestion by code.
 */
export function errorRecovery(code: CMPErrorCode): string {
  return ERROR_RECOVERY[code] || 'No recovery action defined';
}
