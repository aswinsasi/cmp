"use strict";
/**
 * CMP Logger
 * Structured logging with level filtering and component tagging.
 *
 * @module utils/logger
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.LogLevel = void 0;
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
    LogLevel[LogLevel["NONE"] = 4] = "NONE";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
const LEVEL_NAMES = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.NONE]: 'NONE',
};
const LEVEL_COLORS = {
    [LogLevel.DEBUG]: '\x1b[36m', // cyan
    [LogLevel.INFO]: '\x1b[32m', // green
    [LogLevel.WARN]: '\x1b[33m', // yellow
    [LogLevel.ERROR]: '\x1b[31m', // red
    [LogLevel.NONE]: '',
};
const RESET = '\x1b[0m';
class Logger {
    component;
    static globalLevel = LogLevel.INFO;
    /** Optional output hook — if set, all log output goes through this instead of console */
    static outputHook = null;
    constructor(component) {
        this.component = component;
    }
    static setLevel(level) {
        Logger.globalLevel = level;
    }
    /**
     * Set a custom output handler (used by CLI to respect readline prompt).
     * Pass null to reset to default console output.
     */
    static setOutputHook(hook) {
        Logger.outputHook = hook;
    }
    debug(msg, data) {
        this.log(LogLevel.DEBUG, msg, data);
    }
    info(msg, data) {
        this.log(LogLevel.INFO, msg, data);
    }
    warn(msg, data) {
        this.log(LogLevel.WARN, msg, data);
    }
    error(msg, data) {
        this.log(LogLevel.ERROR, msg, data);
    }
    log(level, msg, data) {
        if (level < Logger.globalLevel)
            return;
        const timestamp = new Date().toISOString().substring(11, 23);
        const color = LEVEL_COLORS[level];
        const levelStr = LEVEL_NAMES[level].padEnd(5);
        let line = `${color}[${timestamp}] ${levelStr}${RESET} [${this.component}] ${msg}`;
        if (data !== undefined) {
            line += ` ${typeof data === 'object' ? JSON.stringify(data) : data}`;
        }
        if (Logger.outputHook) {
            Logger.outputHook(line);
        }
        else if (level >= LogLevel.ERROR) {
            console.error(line);
        }
        else if (level >= LogLevel.WARN) {
            console.warn(line);
        }
        else {
            console.log(line);
        }
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map