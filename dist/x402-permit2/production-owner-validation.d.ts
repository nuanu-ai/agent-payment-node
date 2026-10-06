import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { Permit2WalletBinding } from "./owner-binding.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
/** Pure existing predicates; these functions confer no lock, policy-reader or signing authority. */
export declare function assertPermit2OwnerIdentity(record: Permit2ProductionRecord, wallet: Permit2WalletBinding, active: ActiveAssetPolicy | null): asserts active is ActiveAssetPolicy;
export declare function assertPermit2OwnerCaps(record: Permit2ProductionRecord, now: Date, usage: string, active: ActiveAssetPolicy): void;
