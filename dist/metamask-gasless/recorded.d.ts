import type { Address } from "../model.js";
import type { MetaMaskGaslessDeployment, MetaMaskGaslessIntent, MetaMaskGaslessProtocolName } from "./model.js";
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
/**
 * The deployment an observation proves against: the token, manager and enforcer addresses this record froze, with the
 * code pins its own prepare snapshot read. A pin change in a later release refuses new prepares only; an operation sent
 * before it is still proven against what it was sent with. Chain facts (finality tag) and the 7702 delegate address,
 * which a record without a designation at prepare does not hold, come from the registry row of the chain.
 */
export declare function mmObservedDeployment(intent: MetaMaskGaslessIntent, chain: MetaMaskGaslessDeployment): MetaMaskGaslessDeployment;
