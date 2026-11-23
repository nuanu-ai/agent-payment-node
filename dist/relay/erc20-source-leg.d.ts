import type { AssetUsageIdentity } from "../asset-usage-ledger.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { type RelayToken } from "./token-routes.js";
export interface RelayErc20Envelope {
    readonly from: string;
    readonly to: string;
    readonly data: string;
    readonly value: "0";
    readonly chainId: number;
    readonly gas: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
    readonly maximumNetworkFeeWei: string;
}
export interface RelayErc20SourceLeg {
    readonly chainId: number;
    readonly chain: string;
    /** EIP-55 source token: the identity of the owner policy row and of the usage hold. */
    readonly token: string;
    readonly depository: string;
    readonly orderId: string;
    readonly approval: RelayErc20Envelope;
    readonly deposit: RelayErc20Envelope;
    /** The chain's consensus-safe block tag for nonce and checkpoint reads. */
    readonly safeTag: "safe" | "finalized";
    /** Token routes send their own exact approval only from a zero allowance (Ethereum USDT refuses nonzero to nonzero). */
    readonly zeroAllowanceRequired: boolean;
    /** The token a token route pays; null for the Ethereum USDC routes, which pay a native coin. */
    readonly destination: RelayToken | null;
}
/** The relay mechanism pin the owner policy admits; an Ethereum USDC operation is re-proven against its saved route. */
export declare function relayErc20Reference(op: RelayUnsignedOperation): string;
/** The leg's chain, token and envelopes. Ethereum USDC reads its saved quote as before (effect services also re-prove its
 * route with `relayErc20Reference`); a token route is bound to its protocol row and to the operation's own fields here. */
export declare function relayErc20SourceLeg(op: RelayUnsignedOperation): RelayErc20SourceLeg;
/** The source chain, token and depository alone. An operation without a token quote is an Ethereum USDC operation, as
 * before (an early prepared record may carry no quote); a token route is re-bound to its row. */
export declare function relayErc20SourceToken(op: RelayUnsignedOperation): Readonly<{
    chain: string;
    token: string;
    depository: string;
}>;
/** The principal usage hold of the leg: the payer's checksummed account, the source chain and the source token. */
export declare function relayErc20UsageIdentity(op: RelayUnsignedOperation): AssetUsageIdentity;
