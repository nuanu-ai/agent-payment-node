import type { Address, Hex } from "../model.js";
import type { X402PaymentRequired } from "../x402-codec.js";
import { type Permit2SigningPlan } from "./authorization.js";
import { type Permit2Requirement } from "./offer.js";
import { type Permit2Asset, type Permit2AssetResolver } from "./registry.js";
/** The resolver that admits exactly one asset: the operation's own. */
export declare function onlyPermit2Asset(asset: Permit2Asset): Permit2AssetResolver;
/** Values must come from the current, authenticated owner policy and local wallet binding. */
export interface Permit2OwnerAdmission {
    readonly active: boolean;
    readonly account: Address;
    readonly chain: string;
    readonly token: Address;
    readonly rail: "x402";
    readonly mechanism: {
        readonly provider: string;
        readonly reference: string;
    } | null;
    readonly maximumPerTransferAtomic: string;
    readonly dailyLimitAtomic: string;
    readonly usedTodayAtomic: string;
    readonly policyDigest: string;
}
/** Read-only observations acquired for the same pinned chain, account and selected challenge. */
export interface Permit2PrepareEvidence {
    readonly chainId: number;
    readonly account: Address;
    readonly observedAtSeconds: number;
    readonly balanceAtomic: string;
    readonly allowanceAtomic: string;
    /** Read only when a sponsored EIP-2612 permit is needed; null otherwise. */
    readonly tokenDomainSeparator: Hex | null;
    readonly proxyCodeHash: Hex;
    readonly permit2Deployed: boolean;
    readonly nonceBitmapWordIndex: string;
    readonly nonceBitmapWord: Hex;
    readonly eip2612Nonce: string | null;
    readonly facilitator: {
        readonly available: boolean;
        readonly network: string;
        readonly scheme: "exact";
        readonly asset: Address;
        readonly assetTransferMethod: "permit2";
        readonly permit2Address: Address;
        readonly exactProxy: Address;
        readonly eip2612GasSponsoring: boolean;
    };
}
/** The caller must have already obtained and verified this fresh merchant challenge. */
export interface Permit2PrepareInput {
    readonly payer: Address;
    readonly localWallet: true;
    readonly challenge: X402PaymentRequired;
    /** Terms the caller displayed/accepted; a changed merchant 402 cannot be silently substituted. */
    readonly expected: {
        readonly index: number;
        readonly requirement: Permit2Requirement;
        readonly challengeHash: string;
    };
    readonly owner: Permit2OwnerAdmission;
    readonly evidence: Permit2PrepareEvidence;
    /** The admitted asset the evidence was read for; the only offer asset this prepare may pay. */
    readonly asset: Permit2Asset;
    readonly nowSeconds: number;
    /** Random nonce supplied by the caller; this function never signs or sends. */
    readonly nonce: bigint;
}
export interface Permit2PreparedMaterial {
    readonly challengeHash: string;
    readonly offerHash: string;
    readonly policyDigest: string;
    readonly payer: Address;
    readonly chain: `eip155:${number}`;
    readonly token: Address;
    readonly payTo: Address;
    readonly amountAtomic: string;
    readonly expiresAtUnix: string;
    readonly plan: Permit2SigningPlan;
    readonly prepareHash: string;
}
/** Pure prepare domain. The caller supplies trusted policy/RPC/facilitator reads; no effect port is accepted. */
export declare function preparePermit2Payment(input: Permit2PrepareInput): Permit2PreparedMaterial;
export declare function hashChallenge(challenge: Permit2PrepareInput["challenge"]): string;
/** True when the checked 402 declares a valid EIP-2612 gas-sponsoring extension. */
export declare function permit2SellerSponsorsEip2612(challenge: X402PaymentRequired): boolean;
/** The read for one admitted (chain, token): the asset as selected, before its chain facts were read. */
export interface Permit2PrepareReadRequest {
    readonly payer: Address;
    readonly asset: Permit2Asset;
    readonly challengeHash: string;
    readonly offerHash: string;
    readonly amountAtomic: string;
    readonly nowSeconds: number;
    readonly nonceBitmapWordIndex: string;
    /** True when the seller's 402 declares EIP-2612 gas sponsoring; only then may a short allowance read the token domain. */
    readonly sellerSponsorsEip2612: boolean;
    /** The selected offer's payee; an owner recipient pin on the x402 row must list it. */
    readonly payTo: Address;
}
/** Adapter port for serial integration; implementations must return authenticated, fresh reads. */
export interface Permit2PrepareReadPort {
    read(input: Permit2PrepareReadRequest): Promise<{
        readonly owner: Permit2OwnerAdmission;
        readonly evidence: Permit2PrepareEvidence;
        readonly asset: Permit2Asset;
    }>;
}
/** `assets` admits the offers the owner's active policy admits; the lowest-index admitted Permit2 offer is prepared. */
export declare function preparePermit2WithPort(port: Permit2PrepareReadPort, input: Omit<Permit2PrepareInput, "owner" | "evidence" | "nonce" | "asset"> & {
    readonly assets: Permit2AssetResolver;
}): Promise<Permit2PreparedMaterial>;
