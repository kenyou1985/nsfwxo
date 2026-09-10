/**
 * Client-side logging utility for capturing and reporting errors.
 * Logs are written to console and can optionally be stored in localStorage
 * for persistence across sessions.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
  stack?: string;
  componentStack?: string;
  userAgent?: string;
  url?: string;
  viewport?: { width: number; height: number };
  sessionId?: string;
}

const LOG_PREFIX = '[NSFWXO]';
const STORAGE_KEY = 'nsfwxo_error_log';
const MAX_LOG_ENTRIES = 100;

function getSessionId(): string {
  let sessionId = sessionStorage.getItem('nsfwxo_session_id');
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem('nsfwxo_session_id', sessionId);
  }
  return sessionId;
}

function getBasicContext(): Pick<LogEntry, 'userAgent' | 'url' | 'viewport' | 'sessionId'> {
  return {
    userAgent: navigator.userAgent,
    url: window.location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    sessionId: getSessionId(),
  };
}

function formatLog(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    return `${LOG_PREFIX} [${timestamp}] [${level.toUpperCase()}] ${message} %o`;
  }
  return `${LOG_PREFIX} [${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  debug(message: string, data?: unknown) {
    console.log(`[NSFWXO] [${new Date().toISOString()}] ${message}`, data ?? '');
  },

  info(message: string, data?: unknown) {
    console.log(`[NSFWXO] [${new Date().toISOString()}] ${message}`, data ?? '');
  },

  warn(message: string, data?: unknown) {
    console.warn(`[NSFWXO] [${new Date().toISOString()}] ${message}`, data ?? '');
  },

  error(message: string, data?: unknown, error?: Error) {
    const context: Partial<LogEntry> = {};
    if (error) {
      context.stack = error.stack;
    }
    console.error(`[NSFWXO] [${new Date().toISOString()}] ${message}`, { ...context, data });
  },

  /**
   * Log a React error caught by an ErrorBoundary.
   * Includes component stack for debugging which component crashed.
   */
  logReactError(error: Error, errorInfo: React.ErrorInfo) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'error',
      message: `React Error: ${error.message}`,
      data: {
        name: error.name,
        toString: error.toString(),
      },
      stack: error.stack,
      componentStack: errorInfo.componentStack ?? undefined,
      ...getBasicContext(),
    };

    console.error(
      `${LOG_PREFIX} [${new Date().toISOString()}] [ERROR] React Error caught by ErrorBoundary:`,
      entry
    );
    persistLogEntry(entry);
  },

  /**
   * Log an unhandled promise rejection.
   */
  logUnhandledRejection(reason: unknown) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'error',
      message: 'Unhandled Promise Rejection',
      data: reason instanceof Error
        ? { name: reason.name, message: reason.message }
        : { reason },
      stack: reason instanceof Error ? reason.stack : undefined,
      ...getBasicContext(),
    };

    console.error(`${LOG_PREFIX} [${new Date().toISOString()}] [ERROR] Unhandled Promise Rejection:`, entry);
    persistLogEntry(entry);
  },

  /**
   * Log a global window error.
   */
  logWindowError(event: ErrorEvent) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'error',
      message: event.message || 'Window error',
      data: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      ...getBasicContext(),
    };

    console.error(`${LOG_PREFIX} [${new Date().toISOString()}] [ERROR] Window error:`, entry);
    persistLogEntry(entry);
  },

  /**
   * Log a dropdown open event (for tracking which dropdowns crash).
   */
  logDropdownOpen(componentName: string, label: string, options: number) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'debug',
      message: `Dropdown opened: ${componentName} - ${label}`,
      data: { label, options, componentName },
      ...getBasicContext(),
    };
    console.log(`[NSFWXO] [${new Date().toISOString()}] Dropdown opened: ${componentName} - ${label}`, { options });
    persistLogEntry(entry);
  },

  /**
   * Log a dropdown selection event.
   */
  logDropdownSelect(componentName: string, label: string, value: string, label2: string) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'debug',
      message: `Dropdown selected: ${componentName} - ${label} = ${value}`,
      data: { label, value, componentName, selectedLabel: label2 },
      ...getBasicContext(),
    };
    console.log(`[NSFWXO] [${new Date().toISOString()}] Dropdown selected: ${componentName} - ${label} = ${value}`);
    persistLogEntry(entry);
  },

  /**
   * Log an error in ParameterSelect (before crash).
   */
  logParameterSelectError(operation: string, label: string, error: unknown) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'error',
      message: `ParameterSelect error in "${operation}": ${error instanceof Error ? error.message : String(error)}`,
      data: { operation, label, error: error instanceof Error ? error.message : String(error) },
      stack: error instanceof Error ? error.stack : undefined,
      ...getBasicContext(),
    };
    console.error(`${LOG_PREFIX} [${new Date().toISOString()}] [ERROR] ParameterSelect error:`, entry);
    persistLogEntry(entry);
  },

  /**
   * Log a section toggle event (for tracking advanced options collapse).
   */
  logSectionToggle(sectionName: string, isOpen: boolean) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'debug',
      message: `Section toggled: ${sectionName} -> ${isOpen ? 'open' : 'closed'}`,
      data: { sectionName, isOpen },
      ...getBasicContext(),
    };
    console.log(`[NSFWXO] [${new Date().toISOString()}] Section toggled: ${sectionName} -> ${isOpen ? 'open' : 'closed'}`);
    persistLogEntry(entry);
  },
};

function persistLogEntry(entry: LogEntry) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const logs: LogEntry[] = raw ? JSON.parse(raw) : [];
    logs.unshift(entry);
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.splice(MAX_LOG_ENTRIES);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // localStorage might be full or unavailable
  }
}

export function getStoredLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearStoredLogs() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function exportLogs(): string {
  const logs = getStoredLogs();
  return JSON.stringify(logs, null, 2);
}

// Set up global handlers for unhandled errors
export function setupGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    logger.logWindowError(event);
  });

  window.addEventListener('unhandledrejection', (event) => {
    logger.logUnhandledRejection(event.reason);
  });

  // 性能优化：生产环境下静默来自业务模块的 console.log / console.debug。
  // 只保留 console.warn / console.error 真实告警，避免 1MB+ 的日式刷屏占用
  // CPU + 内存（devtools console 是大型对象，数百条日志会显著拖慢长会话）。
  // 开发环境（import.meta.env.PROD === false）保留完整日志方便调试。
  // 使用 (import.meta as any).env.PROD 避免 vite/client 类型缺失问题。
  const isProd = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD === true;
  if (typeof console !== 'undefined' && isProd) {
    const originalLog = console.log;
    const originalDebug = console.debug;
    console.log = (...args: unknown[]) => {
      // 只放过带有 [NSFWXO] 前缀的错误日志（logger.error 会用 console.error）
      const first = args[0];
      if (typeof first === 'string' && (first.includes('[NSFWXO-ERR]') || first.includes('[NSFWXO-WARN]'))) {
        originalLog.apply(console, args);
      }
    };
    console.debug = () => {
      // 生产环境完全静默 debug
    };
  }
}
