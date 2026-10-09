import { SecureStateStore } from "../secure-state-store.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { RelayBnbRecipientCreditEvidence } from "./destination-proof.js";
export declare class RelayDestinationClaimRepository extends SecureStateStore {
    claim(op: RelayUnsignedOperation, sourceHash: string, proof: RelayBnbRecipientCreditEvidence): Promise<void>;
}
