/**
 * Diagnostics capture — a debugging aid for developing modules against this
 * bridge (or anything else in the same Foundry tab), not for the bridge's own
 * error handling.
 *
 * The problem: when something throws inside Foundry, the only place it appears
 * is the browser DevTools console, which the person driving Claude has to open,
 * read, and paste back by hand. There is no MCP tool today that can see a JS
 * exception. This installs a small ring buffer that captures console.error/warn
 * plus uncaught exceptions and unhandled promise rejections from the moment the
 * module initializes, so a later `get-module-diagnostics` call can read them
 * back without anyone touching DevTools.
 *
 * Deliberately NOT a general log — only error/warn-level output and actual
 * exceptions, bounded in size, in memory only (cleared on reload). Capturing
 * console.log too would mean an enormous amount of routine Foundry chatter for
 * every real signal.
 */

export interface DiagnosticEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'uncaught' | 'unhandledrejection';
  message: string;
  source?: string | undefined;
}

const MAX_ENTRIES = 200;

const buffer: DiagnosticEntry[] = [];
let installed = false;

function push(entry: DiagnosticEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

/** Best-effort stringification — console/error arguments are not always strings. */
function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Wrap console.error/warn and window error/rejection events. Idempotent —
 * safe to call more than once (e.g. a module reload during development)
 * without stacking duplicate wrappers.
 */
export function installDiagnosticsCapture(source: string): void {
  if (installed) return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    push({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: args.map(stringifyArg).join(' '),
      source,
    });
    originalError(...args);
  };

  console.warn = (...args: unknown[]) => {
    push({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: args.map(stringifyArg).join(' '),
      source,
    });
    originalWarn(...args);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('error', event => {
      push({
        timestamp: new Date().toISOString(),
        level: 'uncaught',
        message: event.error ? stringifyArg(event.error) : event.message,
        source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      });
    });

    window.addEventListener('unhandledrejection', event => {
      push({
        timestamp: new Date().toISOString(),
        level: 'unhandledrejection',
        message: stringifyArg(event.reason),
      });
    });
  }

  // Foundry core routes errors from wrapped internal call sites (hook callbacks,
  // scene/canvas rendering, etc.) through Hooks.onError -> Hooks.call("error", ...)
  // with a location tag, instead of always letting them reach window.onerror. Without
  // this, some Foundry-trapped errors never appear in the buffer at all.
  if (typeof Hooks !== 'undefined') {
    Hooks.on('error', (location: string, error: unknown, _options?: unknown) => {
      push({
        timestamp: new Date().toISOString(),
        level: 'uncaught',
        message: stringifyArg(error),
        source: location,
      });
    });
  }
}

/** Most recent entries first, optionally limited. Does not clear the buffer. */
export function getDiagnosticEntries(limit?: number): DiagnosticEntry[] {
  const ordered = [...buffer].reverse();
  return limit && limit > 0 ? ordered.slice(0, limit) : ordered;
}

export function clearDiagnosticEntries(): void {
  buffer.length = 0;
}
