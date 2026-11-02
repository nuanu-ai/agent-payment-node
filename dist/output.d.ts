import type { CommandOutcome, CommandRequest, OutputEnvelope } from "./commands.js";
export declare function successEnvelope(request: CommandRequest, requestId: string, outcome: CommandOutcome): OutputEnvelope;
/**
 * `externalWallet` is true only when the failed request acted through an external wallet provider (a connect to one, or
 * a profile bound to one; see external-wallet-request.ts). Only then are wallet-provider steps (pinned client, foreground
 * connect, local profile, revision) suggested; a local-profile or anonymous request gets its error's own next actions or
 * none, never those.
 */
export declare function failureEnvelope(command: string, requestId: string, error: unknown, externalWallet?: boolean): OutputEnvelope;
/**
 * The operation index names the blocker for every family; its status shows what it waits for (and, for a record of an
 * unreleased Stargate schema, runs the chain-proven closure). Where that status only reads the record, the command
 * boundary, which can read the blocker's family, appends the family's own observing command (operation-blocker-guidance.ts).
 * A blocker whose record cannot be read has one more exit: the owner releases its claims with TTY consent (the record and
 * any ledger hold stay as they are).
 */
export declare function blockedNextActions(blocker: string, unreadable: boolean): readonly string[];
/** One plain line per earlier operation the invocation closed (`closed_blockers`), for a person at the terminal. */
export declare function closedBlockerNotes(envelope: OutputEnvelope): readonly string[];
