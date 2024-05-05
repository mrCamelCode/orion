export enum LogLevel {
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

const logLevelToPriority: Record<LogLevel, number> = {
  [LogLevel.Info]: 10,
  [LogLevel.Warn]: 20,
  [LogLevel.Error]: 30,
};

const longestLogLevelName = Math.max(...Object.values(LogLevel).map((value) => value.length));

export class Logger {
  constructor(public logLevel = LogLevel.Info) {}

  info(msg: string): void {
    this.#log(msg, LogLevel.Info);
  }

  warn(msg: string): void {
    this.#log(msg, LogLevel.Warn);
  }

  error(msg: string): void {
    this.#log(msg, LogLevel.Error);
  }

  #log(msg: string, logLevel: LogLevel): void {
    if (this.#shouldLogAtLevel(logLevel)) {
      const parts = [new Date().toISOString().padEnd(30), `[${logLevel.padEnd(longestLogLevelName)}]:  `, msg];

      console.log(parts.join(''));
    }
  }

  #shouldLogAtLevel(logLevel: LogLevel): boolean {
    const desiredPriority = logLevelToPriority[this.logLevel];
    const logPriority = logLevelToPriority[logLevel];

    return logPriority >= desiredPriority;
  }
}

/**
 * The app's default logger.
 */
export const logger = new Logger();
