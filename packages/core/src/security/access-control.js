"use strict";
/**
 * CMP v4.0 — Access Control
 *
 * Per-node ACL controlling who can submit tasks.
 *
 * Modes:
 *   open:       Any device can submit tasks (default)
 *   whitelist:  Only listed mesh IDs allowed
 *   reputation: Minimum reputation score required (default: 2000)
 *   deposit:    Requester must lock CCU in escrow before task starts
 *
 * Multiple modes can be combined (all must pass).
 *
 * @module security/access-control
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessController = exports.DEFAULT_ACL_CONFIG = exports.ACLMode = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('ACL');
// ─── ACL Mode ───
var ACLMode;
(function (ACLMode) {
    ACLMode["OPEN"] = "open";
    ACLMode["WHITELIST"] = "whitelist";
    ACLMode["REPUTATION"] = "reputation";
    ACLMode["DEPOSIT"] = "deposit";
})(ACLMode || (exports.ACLMode = ACLMode = {}));
exports.DEFAULT_ACL_CONFIG = {
    modes: [ACLMode.OPEN],
    whitelist: new Set(),
    minReputation: 2000,
    minDeposit: 10,
};
// ─── Access Controller ───
class AccessController {
    config;
    // Stats
    stats = {
        totalChecks: 0,
        allowed: 0,
        denied: 0,
        deniedByMode: {},
    };
    constructor(config = {}) {
        this.config = {
            ...exports.DEFAULT_ACL_CONFIG,
            ...config,
            whitelist: config.whitelist ?? new Set(exports.DEFAULT_ACL_CONFIG.whitelist),
            modes: config.modes ?? [...exports.DEFAULT_ACL_CONFIG.modes],
        };
    }
    /**
     * Check if a device is allowed to submit tasks.
     */
    check(deviceId, reputation = 0, ccuBalance = 0) {
        this.stats.totalChecks++;
        for (const mode of this.config.modes) {
            switch (mode) {
                case ACLMode.OPEN:
                    // Always passes
                    break;
                case ACLMode.WHITELIST:
                    if (!this.config.whitelist.has(deviceId)) {
                        this.stats.denied++;
                        this.stats.deniedByMode[ACLMode.WHITELIST] = (this.stats.deniedByMode[ACLMode.WHITELIST] || 0) + 1;
                        return {
                            allowed: false,
                            reason: `Device ${deviceId.substring(0, 8)} not in whitelist`,
                            failedMode: ACLMode.WHITELIST,
                        };
                    }
                    break;
                case ACLMode.REPUTATION:
                    if (reputation < this.config.minReputation) {
                        this.stats.denied++;
                        this.stats.deniedByMode[ACLMode.REPUTATION] = (this.stats.deniedByMode[ACLMode.REPUTATION] || 0) + 1;
                        return {
                            allowed: false,
                            reason: `Reputation ${reputation} below minimum ${this.config.minReputation}`,
                            failedMode: ACLMode.REPUTATION,
                        };
                    }
                    break;
                case ACLMode.DEPOSIT:
                    if (ccuBalance < this.config.minDeposit) {
                        this.stats.denied++;
                        this.stats.deniedByMode[ACLMode.DEPOSIT] = (this.stats.deniedByMode[ACLMode.DEPOSIT] || 0) + 1;
                        return {
                            allowed: false,
                            reason: `CCU balance ${ccuBalance} below deposit requirement ${this.config.minDeposit}`,
                            failedMode: ACLMode.DEPOSIT,
                        };
                    }
                    break;
            }
        }
        this.stats.allowed++;
        return { allowed: true, reason: 'All ACL checks passed', failedMode: null };
    }
    // ── Configuration ──
    /**
     * Set active ACL modes.
     */
    setModes(modes) {
        this.config.modes = modes;
        log.info(`ACL modes set: ${modes.join(', ')}`);
    }
    /**
     * Add a device to the whitelist.
     */
    addToWhitelist(deviceId) {
        this.config.whitelist.add(deviceId);
    }
    /**
     * Remove a device from the whitelist.
     */
    removeFromWhitelist(deviceId) {
        this.config.whitelist.delete(deviceId);
    }
    /**
     * Set minimum reputation threshold.
     */
    setMinReputation(min) {
        this.config.minReputation = min;
    }
    /**
     * Set minimum deposit.
     */
    setMinDeposit(min) {
        this.config.minDeposit = min;
    }
    /**
     * Get current config.
     */
    getConfig() {
        return { ...this.config, whitelist: new Set(this.config.whitelist) };
    }
    /**
     * Get ACL stats.
     */
    getStats() {
        return { ...this.stats, deniedByMode: { ...this.stats.deniedByMode } };
    }
}
exports.AccessController = AccessController;
//# sourceMappingURL=access-control.js.map