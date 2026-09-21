import { type ErrorCode } from "../errors.js";
import type { BridgeObservationRpcFailure } from "./operation-model.js";
export declare function observationRpcFailure(chainRole: "source" | "destination", effectRole: "approval" | "bridge", error: unknown, fallbackCode?: ErrorCode | null): BridgeObservationRpcFailure;
