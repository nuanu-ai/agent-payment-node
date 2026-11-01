import type { ClockPort, WaitPort } from "../ports.js";
import type { StateStore } from "../state.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import { type MetaMaskGaslessSave, type MetaMaskGaslessStep } from "./observation.js";
import type { MetaMaskGaslessApprovalPort, MetaMaskGaslessProviderPort, MetaMaskGaslessRpcFactory } from "./ports.js";
export declare class MetaMaskGaslessExecution {
    private readonly state;
    private readonly rpcFor;
    private readonly provider;
    private readonly save;
    private readonly wait;
    private readonly clock;
    private readonly observation;
    constructor(state: StateStore, rpcFor: MetaMaskGaslessRpcFactory, provider: MetaMaskGaslessProviderPort, clock: ClockPort, save: MetaMaskGaslessSave, wait: WaitPort);
    /** `siblings` are the account's earlier unresolved transfers, collected by the caller before this approval screen. */
    approve(op: MetaMaskGaslessOperationRecord, approval: MetaMaskGaslessApprovalPort, siblings: readonly MetaMaskGaslessOperationRecord[]): Promise<MetaMaskGaslessStep>;
    /** `siblings` as for `approve`; they are only compared, so a dispatched operation that only observes needs none. */
    run(op: MetaMaskGaslessOperationRecord, siblings: readonly MetaMaskGaslessOperationRecord[]): Promise<MetaMaskGaslessStep>;
    /**
     * Every check between the owner's approval and the dispatch marker, re-taken now. The prepared snapshot is
     * identity and designation evidence; the dispatch clock runs on the read taken here. The owner approved a
     * maximum, so a fresh quote inside that maximum is priced at execution and its delegation re-derived.
     */
    private guard;
    /** The provider builds the unsigned delegation over the repriced batch; APN verifies it independently. */
    private redelegate;
    private chainState;
    /**
     * A rate limit, a transport failure or a price move above the owner's maximum is waited out while the approved
     * window still leaves room for the dispatch itself. An interrupt, an exhausted window and every definite
     * refusal end the operation at once, and nothing here can run once the marker write has started.
     */
    private steady;
    private halt;
}
