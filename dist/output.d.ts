import type { CommandOutcome, CommandRequest, OutputEnvelope } from "./commands.js";
export declare function successEnvelope(request: CommandRequest, requestId: string, outcome: CommandOutcome): OutputEnvelope;
/**
 * `externalWallet` is true only when the failed request acted through an external wallet provider (a connect to one, or
 * a profile bound to one; see external-wallet-request.ts). Only then are wallet-provider steps (pinned client, foreground
 * connect, local profile, revision) suggested; a local-profile or anonymous request gets its error's own next actions or
 * none, never those.
 */
export declare function failureEnvelope(command: string, requestId: string, error: unknown, externalWallet?: boolean): OutputEnvelope;
