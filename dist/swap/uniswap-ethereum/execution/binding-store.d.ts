import { SecureStateStore } from "../../../secure-state-store.js";
import { type SwapOperationRecord } from "../../model.js";
import type { UniswapExecutionBinding } from "./types.js";
/**
 * Durable execution binding, written after the submission marker and before signing. It holds no secret: resume
 * needs it to open the encrypted effect and to observe the exact transaction without ever signing or sending again.
 */
export declare class UniswapExecutionBindingStore extends SecureStateStore {
    private initialized;
    save(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding): Promise<UniswapExecutionBinding>;
    load(operationValue: SwapOperationRecord): Promise<UniswapExecutionBinding | null>;
    private path;
    private ready;
}
