import { constants } from "node:os";

/**
 * The exit code a launcher passes on for a child that exited with `code` or was ended by `signal`:
 * a shell's 128 + the signal's number (143 for SIGTERM). Re-raising the signal on itself would not do:
 * the launcher's own forwarding handler would swallow it, and as PID 1 in the container the kernel ignores it.
 */
export function exitCode(code, signal) {
  if (signal) return 128 + (constants.signals[signal] ?? 0);
  return code ?? 1;
}
