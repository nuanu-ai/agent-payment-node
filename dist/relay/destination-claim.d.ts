import { SecureStateStore } from "../secure-state-store.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { RelayBnbRecipientCreditEvidence } from "./destination-proof.js";
import type { RelayEthereumUsdcCreditProof } from "./ethereum-usdc-credit-proof.js";
export declare class RelayDestinationClaimRepository extends SecureStateStore {
    claim(op: RelayUnsignedOperation, sourceHash: string, proof: RelayBnbRecipientCreditEvidence): Promise<void>;
    /** The Ethereum USDC payout of an Arbitrum USDC operation whose deposit the saved source journal records as final. */
    claimEthereumUsdc(op: RelayUnsignedOperation, sourceHash: string, proof: RelayEthereumUsdcCreditProof): Promise<void>;
    private persist;
}
