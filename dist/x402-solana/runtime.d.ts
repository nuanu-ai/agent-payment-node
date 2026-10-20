import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
import type { X402SolanaRecord } from "./model.js";
import type { X402SolanaPorts } from "./service.js";
/**
 * The family's ports. The chain port exists only with an explicit APN_SOLANA_RPC_URL (never the public default other
 * Solana commands may use); without it every chain read refuses, naming that setting.
 */
export declare function x402SolanaPorts(root: string, options: RuntimeFactoryOptions, foreground: boolean): X402SolanaPorts;
export declare function x402SolanaApprovalPhrase(record: X402SolanaRecord): string;
/** The owner's unknown-effect abandon screen for an exposed payment no proof decides. */
export declare function approveX402SolanaAbandon(port: OperationAbandonApprovalPort, record: X402SolanaRecord): Promise<void>;
