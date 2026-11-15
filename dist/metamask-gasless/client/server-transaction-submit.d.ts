import type { HelperNetworkPolicy } from "./network.js";
import { type PrivateSession } from "./private-state.js";
import { type MetaMaskServerTransactionAnswer, type MetaMaskServerTransactionInput, type ServerTransactionProgress } from "./server-transaction.js";
import type { SubmitStage } from "./submit-diagnostic.js";
/** The submit's own stage and the answer check that refused, for its closed diagnostic (submit-diagnostic.ts). */
export interface ServerTransactionSubmitProgress extends ServerTransactionProgress {
    stage: SubmitStage;
}
/**
 * Only the request's own session may send it: a session signed in to another project than `projectHash` (when the
 * request names one), or whose selected server wallet is not `tx.from`, refuses before any network call.
 */
export declare function assertServerTransactionSession(session: PrivateSession, input: MetaMaskServerTransactionInput): void;
/**
 * One server-wallet transaction request with APN's own id: the SDK's low-level server adapter call `mm wallet
 * send-transaction` reaches (`EvmServerAdapter.submitTransaction(tx, { chainId, requestId, intent })`), without mm's
 * own preparation reads (APN read the nonce, fees and balances itself before consent and again in its last guard). The
 * session is read twice around the SDK's construction, as the gasless submit reads it, so a login that changed between
 * them sends nothing. The network policy admits the one POST of exactly `serverTransactionBody(input)`.
 */
export declare function submitServerTransaction(input: MetaMaskServerTransactionInput, first: PrivateSession, home: string, now: () => Date, policy: HelperNetworkPolicy, sent: ServerTransactionSubmitProgress): Promise<MetaMaskServerTransactionAnswer>;
