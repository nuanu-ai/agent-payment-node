import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { assertExclusiveEvmOwner } from "../evm-address-ownership.js";
import type { StateStore } from "../state.js";
import type { OperationService } from "../operation-service.js";
import { permit2WalletBinding } from "./owner-binding.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
import { assertPermit2OwnerIdentity, assertPermit2OwnerCaps } from "./production-owner-validation.js";
/** Caller holds the existing profile/operation/account locks; common usage was sampled outside them. */
export async function assertPermit2OwnerLocked(state: StateStore, operations: OperationService,
  record: Permit2ProductionRecord, now: Date, usage: string) {
    const wallet = await permit2WalletBinding(state, record.material.wallet.profile);
    await assertExclusiveEvmOwner(state, wallet.account, wallet.profileHash);
    const active = await loadActiveAssetPolicyRegistry(state.root, wallet.profile, now);
    assertPermit2OwnerIdentity(record, wallet, active);
    await operations.assertPermit2AccountAvailable(record);
    assertPermit2OwnerCaps(record, now, usage, active);
    return active;
  }
