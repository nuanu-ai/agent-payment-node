import type { Hex } from "../model.js";
import type { GaslessAccounting, GaslessIntent, GaslessProtocolReceipt } from "./model.js";
export declare function gaslessAccounting(intent: GaslessIntent, userOperationHash: Hex, receipt: GaslessProtocolReceipt): GaslessAccounting;
