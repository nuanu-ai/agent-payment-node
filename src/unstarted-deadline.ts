/**
 * An effect its family never started cannot start once this long has passed after the family's own signing deadline
 * (every family that uses it refuses to sign past that deadline). It is the bound of the operation index's admission
 * lease, so a process that stalls between its deadline check and its effect marker is covered as long as an orphaned
 * admission would be. A leaf module: family journals and index adapters both read it without an import cycle.
 */
export const UNSTARTED_DEADLINE_MARGIN_MS = 10 * 60_000;

/** True once `deadline` (ISO time or epoch milliseconds) plus the margin has passed; an unreadable deadline never passes. */
export function pastUnstartedDeadline(deadline: string | number, now = Date.now()): boolean {
  const at = typeof deadline === "number" ? deadline : Date.parse(deadline);
  return Number.isFinite(at) && now >= at + UNSTARTED_DEADLINE_MARGIN_MS;
}
