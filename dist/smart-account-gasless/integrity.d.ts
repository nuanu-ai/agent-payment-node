import type { Hex } from "../model.js";
import type { SmartAccountGaslessBinding, SmartAccountGaslessMaterialHashes, SmartAccountGaslessRequest, SmartAccountGaslessRequirements } from "./model.js";
export declare const SA_MATERIAL_DOMAINS: Readonly<{
    encodedRoot: "apn.smart-account.gasless.encoded-root.v1";
    encodedChild: "apn.smart-account.gasless.encoded-child.v1";
    permissionContext: "apn.smart-account.gasless.permission-context.v1";
    payload: "apn.smart-account.gasless.payload.v1";
    requirements: "apn.smart-account.gasless.requirements.v1";
    material: "apn.smart-account.gasless.material.v1";
}>;
export declare function saSame(first: unknown, second: unknown): boolean;
/** Policy binds unchanged authority and exact atomic economics, independently of mutable observations. */
export declare function saPolicyHash(binding: SmartAccountGaslessBinding, request: SmartAccountGaslessRequest): string;
export declare function saRequirementsHash(requirements: SmartAccountGaslessRequirements): string;
/** Hash the canonical lowercase encoded one-root delegation context, as UTF-8 hex like retained APN material. */
export declare function saRootContextHash(rootContext: Hex): string;
export declare function saMaterialHash(operationId: string, fingerprint: string, hashes: Omit<SmartAccountGaslessMaterialHashes, "materialHash">): string;
export declare function saSalt(operationId: string, fingerprint: string): Hex;
