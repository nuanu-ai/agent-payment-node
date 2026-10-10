import { type Hex } from "viem";
import { type CircleEnvelope } from "./operation-model.js";
/** Pure, internal wire check. Production intent identity is authenticated by the controller. */
export declare function assertCleanup86RestoredWire(raw: Hex, envelope: CircleEnvelope, transactionHash: Hex): Promise<void>;
