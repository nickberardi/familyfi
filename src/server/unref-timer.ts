/**
 * Lets the process exit while a background timer is pending. Server timers are Node's, but the
 * shared UI components (`src/ui`) bring React Native's global types into the same TypeScript
 * program, which type `setTimeout` and `setInterval` as returning numbers; this accepts either.
 */
export function unrefTimer(timer: unknown): void {
  (timer as { unref?: () => void } | null)?.unref?.();
}
