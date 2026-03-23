/**
 * sentry.ts (STUB)
 *
 * Minimal placeholder that satisfies imports from GanttErrorBoundary.tsx
 * without requiring the @sentry/react package.
 *
 * Replace this with the full version from PR4 when you set up Sentry.
 */

export function initSentry(): void {}
export function setSentryUser(_userId: string, _email?: string): void {}
export function clearSentryUser(): void {}
export function captureError(error: unknown, _context?: Record<string, unknown>): void {
  console.error('[PrestoPlan Error]', error);
}
