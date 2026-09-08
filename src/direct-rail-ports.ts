/** Finite direct-payment rails. This does not expose arbitrary signing. */
export type DirectRailName = "solana" | "tron";
export type ChainProvider = "local" | "coinbase-awal";
export type ChainAssetAlias = "sol" | "usdc" | "trx" | "usdt";

export interface ChainAsset {
  readonly rail: DirectRailName;
  readonly network: "mainnet";
  readonly alias: ChainAssetAlias;
  readonly kind: "native" | "token";
  readonly identifier: string;
  readonly symbol: "SOL" | "USDC" | "TRX" | "USDT";
  readonly decimals: 6 | 9;
}

export interface ChainAccount {
  readonly schemaVersion: "apn.chain-account.v1";
  readonly profile: string;
  readonly profileHash: string;
  readonly rail: DirectRailName;
  readonly network: "mainnet";
  readonly provider: ChainProvider;
  readonly custody: "local_software" | "provider_managed";
  readonly address: string;
  readonly createdAt: string;
  readonly identityHash: string;
}

export interface ChainBalance {
  readonly account: ChainAccount;
  readonly asset: ChainAsset;
  readonly amountAtomic: string;
  readonly nativeBalanceAtomic: string;
  readonly networkIdentity: string;
  readonly blockNumberAtomic: string;
  readonly observedAt: string;
  readonly rpcOriginHash: string;
}

export interface RailEconomics {
  /** Both maxima are denominated in the rail's native atomic unit. */
  readonly networkFeeMaximumAtomic: string;
  readonly recipientRentAtomic: string;
  readonly maximumNativeDebitAtomic: string;
  readonly networkFeePayer: string;
  readonly rentPayer: string | null;
  readonly feeControl: "signed_message" | "provider_guarantee";
}

export interface RailPreparedTransfer {
  readonly rail: DirectRailName;
  readonly networkIdentity: string;
  readonly asset: ChainAsset;
  readonly sender: string;
  readonly recipient: string;
  readonly amountAtomic: string;
  readonly maximumFeeAtomic: string;
  readonly economics: RailEconomics;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly blockReference: string;
  readonly lastValidBlockHeight: string | null;
  /** Unsigned protocol bytes. Never included in a public operation projection. */
  readonly unsignedPayload: string | null;
  readonly sourceTokenAccount: string | null;
  readonly destinationTokenAccount: string | null;
  readonly createsRecipientAccount: boolean;
}

/** Reusable bytes belong only in encrypted custody storage, never public state. */
export interface RailSignedEffect {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly transactionId: string;
  readonly rawPayload: string;
  readonly rawPayloadHash: string;
}

export interface RailFinalEvidence {
  readonly networkIdentity: string;
  readonly transactionId: string;
  readonly blockNumberAtomic: string;
  readonly blockId: string;
  readonly finality: "finalized" | "solidified";
  readonly sender: string;
  readonly recipient: string;
  readonly assetIdentifier: string;
  readonly amountAtomic: string;
  readonly actualNetworkFeeAtomic: string;
  readonly actualRecipientRentAtomic: string;
  readonly networkFeePayer: string;
  readonly senderEffectVerified: boolean;
  readonly recipientEffectVerified: boolean;
  readonly transactionVerified: true;
  readonly observedAt: string;
  readonly rpcOriginHash: string;
}

export type RailInspection =
  | { readonly status: "pending" | "unproven"; readonly reason: string }
  | {
    readonly status: "completed" | "failed_confirmed_revert";
    readonly reason: string;
    readonly proofClass: string;
    readonly evidence: RailFinalEvidence;
  };

export interface RailEffectBinding {
  readonly account: ChainAccount;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly prepared: RailPreparedTransfer;
}

export interface DirectRailPort {
  readonly rail: DirectRailName;
  readonly provider: ChainProvider;
  readonly execution: "local_signed" | "provider_atomic";
  asset(alias: ChainAssetAlias): ChainAsset;
  canonicalAddress(input: string): string;
  assertNetwork(): Promise<string>;
  account(profile: string): Promise<ChainAccount | null>;
  ensureAccount(profile: string): Promise<ChainAccount>;
  balance(account: ChainAccount, asset: ChainAsset): Promise<ChainBalance>;
  prepare(input: {
    readonly account: ChainAccount;
    readonly asset: ChainAsset;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly maximumFeeAtomic: string;
    readonly now: Date;
  }): Promise<RailPreparedTransfer>;
  revalidate(account: ChainAccount, prepared: RailPreparedTransfer): Promise<void>;
  /** Local-only: seal exactly one matching effect before returning it. */
  sign(binding: RailEffectBinding): Promise<RailSignedEffect>;
  recoverEffect(binding: RailEffectBinding): Promise<RailSignedEffect | null>;
  /** Called only after durable `submitting`; a thrown error is ambiguous. */
  submit(binding: RailEffectBinding, effect: RailSignedEffect | null): Promise<{ readonly transactionId: string }>;
  inspect(account: ChainAccount, prepared: RailPreparedTransfer, transactionId: string): Promise<RailInspection>;
}

export interface ChainWalletStoragePort {
  account(profile: string, rail: DirectRailName): Promise<ChainAccount | null>;
  ensureLocal(input: {
    readonly profile: string;
    readonly rail: DirectRailName;
    readonly create: () => Promise<{ readonly address: string; readonly seed: Buffer }>;
  }): Promise<ChainAccount>;
  ensureProvider(input: {
    readonly profile: string;
    readonly rail: DirectRailName;
    readonly provider: "coinbase-awal";
    readonly address: string;
  }): Promise<ChainAccount>;
  withSeed<T>(account: ChainAccount, action: (seed: Buffer) => Promise<T>): Promise<T>;
  effect(account: ChainAccount, operationId: string, fingerprint: string): Promise<RailSignedEffect | null>;
  saveEffect(account: ChainAccount, effect: RailSignedEffect): Promise<void>;
}

export interface RailApprovalPort {
  approve(input: {
    readonly account: ChainAccount;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly policyHash: string;
    readonly prepared: RailPreparedTransfer;
  }): Promise<void>;
}
