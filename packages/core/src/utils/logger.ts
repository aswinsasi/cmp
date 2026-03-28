/**
 * CMP Logger
 * Structured logging with level filtering and component tagging.
 *
 * @module utils/logger
 * @author Agent Viscro
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.NONE]: 'NONE',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '\x1b[36m',  // cyan
  [LogLevel.INFO]: '\x1b[32m',   // green
  [LogLevel.WARN]: '\x1b[33m',   // yellow
  [LogLevel.ERROR]: '\x1b[31m',  // red
  [LogLevel.NONE]: '',
};

const RESET = '\x1b[0m';

export class Logger {
  private component: string;
  private static globalLevel: LogLevel = LogLevel.INFO;
  /** Optional output hook — if set, all log output goes through this instead of console */
  private static outputHook: ((line: string) => void) | null = null;

  constructor(component: string) {
    this.component = component;
  }

  static setLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  /**
   * Set a custom output handler (used by CLI to respect readline prompt).
   * Pass null to reset to default console output.
   */
  static setOutputHook(hook: ((line: string) => void) | null): void {
    Logger.outputHook = hook;
  }

  debug(msg: string, data?: any): void {
    this.log(LogLevel.DEBUG, msg, data);
  }

  info(msg: string, data?: any): void {
    this.log(LogLevel.INFO, msg, data);
  }

  warn(msg: string, data?: any): void {
    this.log(LogLevel.WARN, msg, data);
  }

  error(msg: string, data?: any): void {
    this.log(LogLevel.ERROR, msg, data);
  }

  private log(level: LogLevel, msg: string, data?: any): void {
    if (level < Logger.globalLevel) return;

    const timestamp = new Date().toISOString().substring(11, 23);
    const color = LEVEL_COLORS[level];
    const levelStr = LEVEL_NAMES[level].padEnd(5);

    let line = `${color}[${timestamp}] ${levelStr}${RESET} [${this.component}] ${msg}`;
    if (data !== undefined) {
      line += ` ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }

    if (Logger.outputHook) {
      Logger.outputHook(line);
    } else if (level >= LogLevel.ERROR) {
      console.error(line);
    } else if (level >= LogLevel.WARN) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
