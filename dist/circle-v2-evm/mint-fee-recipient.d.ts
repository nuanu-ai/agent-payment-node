import { type Address } from "viem";
import { type CircleObservation } from "./protocol.js";
import { type CircleRpc } from "./rpc.js";
/** Authenticate the getter against the pinned deployment at the receipt's exact canonical block. No journal fields. */
export declare function readCircleMintFeeRecipient(rpc: CircleRpc, observation: CircleObservation): Promise<Address>;
