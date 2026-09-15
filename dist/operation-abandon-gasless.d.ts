import type { FacilitatorGaslessService } from "./facilitator-gasless/service.js";
import type { GaslessService } from "./gasless/service.js";
import type { MetaMaskGaslessService } from "./metamask-gasless/service.js";
import type { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";
interface Base {
    readonly context: RuntimeContext;
    readonly operations: OperationService;
}
/** Owner release of a disclosed Local gasless effect whose outcome stayed unknown after its approval window. */
export declare function abandonLocalGasless(d: Base & {
    readonly gasless: GaslessService;
}, operationId: string): Promise<unknown>;
/** Owner release of a MetaMask gasless relay whose outcome stayed unknown after its approval window. */
export declare function abandonMetaMaskGasless(d: Base & {
    readonly metaMaskGasless: MetaMaskGaslessService;
}, operationId: string): Promise<unknown>;
/** Owner release of an exposed Avalanche authorization whose use stayed unproven after its on-chain validity ended. */
export declare function abandonFacilitatorGasless(d: Base & {
    readonly facilitatorGasless: FacilitatorGaslessService;
}, operationId: string): Promise<unknown>;
export {};
