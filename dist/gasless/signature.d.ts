import type { Hex } from "../model.js";
import type { GaslessBootstrapMaterial } from "./ports.js";
import type { GaslessIntent, GaslessUserOperation } from "./model.js";
/** Valid low-s ECDSA shape which is never produced by or accepted as an APN owner signature. */
export declare const GASLESS_ESTIMATE_SIGNATURE: Hex;
export declare function verifyGaslessBootstrap(intent: GaslessIntent, value: Pick<GaslessBootstrapMaterial, "permitSignature" | "authorization">): Promise<void>;
export declare function verifyGaslessUserOperation(intent: GaslessIntent, value: GaslessUserOperation): Promise<Hex>;
