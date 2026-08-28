import type { Address } from "./model.js";

export type CommandRequest =
  | { readonly command: "version" }
  | { readonly command: "doctor.keychain" }
  | { readonly command: "wallet.ensure"; readonly profile: string }
  | { readonly command: "wallet.status"; readonly profile: string }
  | { readonly command: "wallet.balance"; readonly profile: string }
  | { readonly command: "wallet.policy.show"; readonly profile: string }
  | {
    readonly command: "wallet.policy.set";
    readonly profile: string;
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly maxBalanceEthWei?: string;
  }
  | { readonly command: "x402.inspect"; readonly url: string }
  | {
    readonly command: "x402.fetch.prepare";
    readonly profile: string;
    readonly url: string;
    readonly maxAmountAtomic?: string;
    readonly idempotencyKey: string;
  }
  | { readonly command: "x402.fetch.approve"; readonly operationId: string }
  | {
    readonly command: "transfer.prepare";
    readonly profile: string;
    readonly idempotencyKey: string;
    readonly recipient: Address | string;
    readonly amount: string;
  }
  | { readonly command: "transfer.approve"; readonly operationId: string }
  | { readonly command: "operation.resume"; readonly operationId: string; readonly waitSeconds?: number }
  | { readonly command: "operation.status"; readonly operationId: string }
  | { readonly command: "receipt.get"; readonly operationId: string };

export interface CommandOutcome {
  readonly proofClass: string;
  readonly data: unknown | null;
  readonly operation: unknown | null;
  readonly receipt: unknown | null;
  readonly nextActions: readonly string[];
}

export interface OutputEnvelope {
  readonly version: "apn.cli.v1";
  readonly request_id: string;
  readonly command: string;
  readonly ok: boolean;
  readonly proof_class: string;
  readonly data: unknown | null;
  readonly operation: unknown | null;
  readonly receipt: unknown | null;
  readonly error: null | {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, string | boolean>>;
  };
  readonly next_actions: readonly string[];
}
