import type { Hex } from "../model.js";
import { type MayanOfflineBinding } from "./mayan-offline.js";
export interface MayanProviderStatusInput {
    readonly quote: unknown;
    readonly binding: MayanOfflineBinding;
    /** Independently obtained successful Base source transaction identity. */
    readonly sourceTransactionHash: unknown;
    /** Independently decoded CCTP V1 MessageSent correlation from that transaction. */
    readonly cctpMessageHash: unknown;
    readonly cctpNonce: unknown;
    /** Body of Circle GET /v1/messages/6/{sourceTransactionHash}. */
    readonly circleMessages: unknown;
    /** One or more LI.FI GET /status responses queried by source hash. */
    readonly lifiStatuses: readonly unknown[];
}
export interface MayanProviderStatusHint {
    readonly kind: "offline_mayan_mctp_provider_status_hint";
    readonly transactionId: Hex;
    readonly sourceTransactionHash: Hex;
    readonly cctpMessageHash: Hex;
    readonly cctpNonce: string;
    readonly circleAttestation: Hex;
    readonly receivingSolanaSignature: string;
    readonly providerOutcome: "completed";
    readonly bridgeCompletion: false;
}
/** Parse only the fields documented by Circle CCTP V1 and LI.FI. */
export declare function inspectMayanProviderStatusOffline(input: MayanProviderStatusInput): MayanProviderStatusHint;
