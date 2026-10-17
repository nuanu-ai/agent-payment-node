/**
 * An effect its family never started cannot start once this long has passed after the family's own signing deadline
 * (every family that uses it refuses to sign past that deadline). It is the bound of the operation index's admission
 * lease, so a process that stalls between its deadline check and its effect marker is covered as long as an orphaned
 * admission would be. A leaf module: family journals and index adapters both read it without an import cycle.
 */
export declare const UNSTARTED_DEADLINE_MARGIN_MS: number;
/** True once `deadline` (ISO time or epoch milliseconds) plus the margin has passed; an unreadable deadline never passes. */
export declare function pastUnstartedDeadline(deadline: string | number, now?: number): boolean;
