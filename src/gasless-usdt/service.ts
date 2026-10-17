import { UsdtBoundOperationRepository, type UsdtAnyBoundOperation as UsdtBoundOperation,
  type UsdtBoundReplayIntent } from "./bound-operation.js";
import type { UsdtPolicyPrepared } from "./policy-prepare.js";
import { ApnError } from "../errors.js";

/** Profile-bound access to the gasless USDT bound journal. No signer or dispatcher is reachable from here. */
export class GaslessUsdtOperationService {
  constructor(readonly root: string, private readonly profileHash?: string) {}

  /** Bind an explicit persisted profile hash; profile names are never interpreted as hashes. */
  forProfile(profileHash: string): GaslessUsdtOperationService {
    return new GaslessUsdtOperationService(this.root, profileHash);
  }

  private boundProfile(): string {
    if (this.profileHash === undefined) throw new Error("Gasless USDT operation profile binding is required.");
    return this.profileHash;
  }

  /** Persist the complete domain preparation. This cannot reserve usage or reach a signer. */
  async prepareBound(binding: UsdtPolicyPrepared | import("./policy-prepare-v2.js").UsdtPolicyPreparedV2, idempotencyKey: string, now: Date): Promise<UsdtBoundOperation> {
    return new UsdtBoundOperationRepository(this.root).create(this.boundProfile(), binding, idempotencyKey, now);
  }

  async replayBound(idempotencyKey: string, intent: UsdtBoundReplayIntent): Promise<UsdtBoundOperation | null> {
    return await new UsdtBoundOperationRepository(this.root).replay(this.boundProfile(), idempotencyKey, intent);
  }

  async statusBound(operationId: string): Promise<UsdtBoundOperation> {
    const record = await new UsdtBoundOperationRepository(this.root).load(this.boundProfile(), operationId);
    if (record === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Gasless USDT bound operation was not found.",
      { reason: "bound_operation_not_found", rail: "gasless_usdt" });
    return record;
  }
}
