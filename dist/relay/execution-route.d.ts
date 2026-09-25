import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { RELAY_BASE_ROUTE_REFERENCE, RELAY_ROUTE_REFERENCE } from "./prepare.js";
export declare const RELAY_BASE_ACCOUNT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
export declare function relayExecutionRoute(op: RelayUnsignedOperation): typeof RELAY_ROUTE_REFERENCE | typeof RELAY_BASE_ROUTE_REFERENCE;
