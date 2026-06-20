// Safe localStorage wrapper.
//
// iOS Safari/WebKit throws a SecurityError when localStorage is accessed from a
// third-party iframe (e.g. a Notion embed) while "Prevent Cross-Site Tracking"
// is enabled — which is the default. An uncaught throw during mount tears down
// the React tree and leaves a blank white widget. These helpers swallow that
// error so the widget still renders; persistence is simply skipped when the
// browser blocks it.

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage blocked (e.g. iOS third-party iframe) — ignore */
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage blocked — ignore */
    }
  },
};
