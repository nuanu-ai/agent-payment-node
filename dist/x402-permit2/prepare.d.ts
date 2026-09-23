import type { Address, Hex } from "../model.js";
import type { X402PaymentRequired } from "../x402-codec.js";
import { type Permit2SigningPlan } from "./authorization.js";
import { type Permit2Requirement } from "./offer.js";
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
    readonly tokenDomainSeparator: Hex;
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
    readonly nowSeconds: number;
    /** Random nonce supplied by the caller; this function never signs or sends. */
    readonly nonce: bigint;
}
export interface Permit2PreparedMaterial {
    readonly challengeHash: string;
    readonly offerHash: string;
    readonly policyDigest: string;
    readonly payer: Address;
    readonly chain: "eip155:43114";
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
/** Adapter port for serial integration; implementations must return authenticated, fresh reads. */
export interface Permit2PrepareReadPort {
    read(input: {
        readonly payer: Address;
        readonly chainId: 43114;
        readonly token: Address;
        readonly challengeHash: string;
        readonly offerHash: string;
        readonly amountAtomic: string;
        readonly nonceBitmapWordIndex: string;
    }): Promise<{
        readonly owner: Permit2OwnerAdmission;
        readonly evidence: Permit2PrepareEvidence;
    }>;
}
export declare function preparePermit2WithPort(port: Permit2PrepareReadPort, input: Omit<Permit2PrepareInput, "owner" | "evidence" | "nonce">): Promise<Permit2PreparedMaterial>;
