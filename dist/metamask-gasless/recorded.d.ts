import type { Address } from "../model.js";
import type { MetaMaskGaslessIntent, MetaMaskGaslessProtocolName } from "./model.js";
/** The deployment values a quote or an unsigned delegation is checked against. */
export interface MmDeploymentView {
    readonly token: Address;
    readonly protocol: Readonly<Partial<Record<MetaMaskGaslessProtocolName, {
        readonly address: Address;
    }>>>;
}
/**
 * The deployment exactly as this saved record froze it at prepare. Saved records are validated against their own
 * values, never against today's registry: a registry change refuses new prepares, never the operations already saved.
 */
export declare function mmRecordedDeployment(intent: MetaMaskGaslessIntent): MmDeploymentView;
