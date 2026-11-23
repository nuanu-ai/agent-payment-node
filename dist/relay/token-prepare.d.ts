import type { OperationService } from "../operation-service.js";
import type { ClockPort } from "../ports.js";
import type { StateStore } from "../state.js";
import type { RelayPreparePorts } from "./prepare.js";
export interface RelayTokenPrepareInput {
    readonly profile: string;
    /** CAIP-2 chains and token aliases select the protocol route; nothing else does. */
    readonly sourceChain: string;
    readonly asset: string;
    readonly destinationChain: string;
    readonly destinationAsset: string;
    readonly recipient: string;
    /** Source token atomic units, in the source token's own decimals. */
    readonly amountAtomic: string;
    /** Destination token atomic units, in the destination token's own decimals. */
    readonly minOutputAtomic: string;
    readonly maxApprovalNetworkFeeWei: string;
    readonly maxDepositNetworkFeeWei: string;
    readonly idempotencyKey: string;
}
interface Context {
    readonly state: StateStore;
    readonly clock: ClockPort;
    readonly operations: OperationService;
    readonly ports: RelayPreparePorts;
}
export declare function prepareRelayToken(context: Context, input: RelayTokenPrepareInput): Promise<import("../relay-unsigned-operation.js").PublicRelayUnsignedOperation>;
export {};
