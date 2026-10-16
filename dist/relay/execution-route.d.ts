import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { RELAY_BASE_ROUTE_REFERENCE, RELAY_ROUTE_REFERENCE } from "./prepare.js";
export declare function relayExecutionRoute(op: RelayUnsignedOperation): typeof RELAY_ROUTE_REFERENCE | typeof RELAY_BASE_ROUTE_REFERENCE;
