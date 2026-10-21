import type { StargateConfirmedReceipt, StargateNativeExecutionPorts, StargateNativeJournal, StargateNativeOperation, StargateSourceReceipt } from "./native-execution.js";
/** The receipt's gas used and effective gas price, when the RPC returned both. */
export declare function withSourceFee(source: StargateSourceReceipt, receipt: StargateConfirmedReceipt): StargateSourceReceipt;
/**
 * An observed record written before the fee was kept reads its own source receipt once at the source finality tag and
 * adds the two numbers; the receipt must be the same transaction in the same block. Nothing else of the record changes.
 */
export declare function recordObservedSourceFee(operation: StargateNativeOperation, ports: Pick<StargateNativeExecutionPorts, "waitSourceReceipt">, journal: StargateNativeJournal): Promise<StargateNativeOperation>;
