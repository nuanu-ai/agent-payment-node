import { AssetUsageLedger } from "../asset-usage-ledger.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { type RelayBnbProofPorts } from "./destination-proof.js";
import type { RelayObserveResult, RelaySourceFinalityPorts } from "./observe.js";
import { RelayKeylessStatusService } from "./status.js";
import type { RelayTokenChainId } from "./token-routes.js";
export declare class RelayTokenObserveService {
    private readonly state;
    private readonly source;
    private readonly destination;
    private readonly status;
    private readonly usage;
    private readonly usedInvocations;
    /** Each factory returns a fresh budgeted reader for the named chain: the source chain, then the destination chain. */
    constructor(state: StateStore, source: (chainId: RelayTokenChainId) => RelaySourceFinalityPorts, destination: (chainId: RelayTokenChainId) => RelayBnbProofPorts, status?: RelayKeylessStatusService, usage?: Pick<AssetUsageLedger, "load" | "transition">);
    /** The caller loaded `op` under its explicit profile and checked its retirement marker. */
    observe(op: RelayUnsignedOperation): Promise<RelayObserveResult>;
}
