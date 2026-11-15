import { type MetaMaskNativeDeadline } from "./metamask-native-diagnostic.js";
import { type MetaMaskServerTransactionOutcome } from "./metamask-server-transaction.js";
import type { MetaMaskNativeSubmission } from "./metamask-native-transfer-adapter.js";
/**
 * A native transfer's hand-off outcome from the helper's send. A hash with a live or settled status is acknowledged; a
 * request still before its hash is pending, with the owner's MFA window when MetaMask waits on it; a closed request, a
 * status APN does not know and every failure once the helper may have started stay UNKNOWN. The request id is APN's own
 * and was sealed before the send, so every outcome keeps it; none is a refusal before the effect.
 */
export declare function metaMaskNativeSdkSubmission(outcome: MetaMaskServerTransactionOutcome, startedAt: number, deadline: MetaMaskNativeDeadline): MetaMaskNativeSubmission;
