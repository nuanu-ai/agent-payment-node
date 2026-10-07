import type { ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import type { AssetUsageLedger } from "../../asset-usage-ledger.js";
import type { ChainAccount, ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { type SwapOperationRecord } from "../model.js";
export interface JupiterV1OwnerBinding {
    readonly account: ChainAccount;
    readonly accountBindingHash: string;
    readonly policyDigest: string;
    readonly activationDigest: string;
    readonly admissionHash: string;
}
export declare const JUPITER_V1_MECHANISM_DIGEST: string;
/** Resolves the owner-activated sealed policy and both public/envelope identities before any custody access. */
export declare class JupiterV1OwnerAdmission {
    private readonly accounts;
    private readonly activePolicy;
    private readonly usage;
    private readonly now;
    constructor(accounts: Pick<ChainWalletStoragePort, "account" | "ownerBinding">, activePolicy: (profile: string) => Promise<ActiveAssetPolicy | null>, usage: AssetUsageLedger, now: () => Date);
    localAccount(profile: string, expected?: string): Promise<ChainAccount>;
    resolve(profile: string, amountAtomic: string, minimumOutputAtomic: string, expected?: string, ownReservationAtomic?: string): Promise<JupiterV1OwnerBinding>;
    assert(operationValue: SwapOperationRecord, materialValue: unknown): Promise<JupiterV1OwnerBinding>;
}
export declare function jupiterV1AccountBindingHash(account: ChainAccount): string;
export declare function detached<T>(value: T): T;
