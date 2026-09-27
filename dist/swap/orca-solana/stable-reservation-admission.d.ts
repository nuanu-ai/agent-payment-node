import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import type { SwapOperationRecord } from "../model.js";
import type { OrcaStableAdmissionPorts } from "./stable-admission.js";
/** Exclude this operation's own durable reservation from a later admission check after a crash. */
export declare function stableReservationAdmissionPorts(ports: OrcaStableAdmissionPorts, usage: AssetUsageLedger, operation: SwapOperationRecord): OrcaStableAdmissionPorts;
