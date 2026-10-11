import type { MetaMaskGaslessDeploymentRow, MetaMaskGaslessProtocolPins } from "./model.js";
/** Stock delegation-framework 1.3.0; selected only by the explicit sponsored schema. */
export declare const MM_SINGLE_ENFORCER: Readonly<{
    readonly address: "0x146713078d39ecc1f5338309c28405ccf85abfbb";
    readonly codeHash: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e";
}>;
export declare function mmProtocolPins(row: MetaMaskGaslessDeploymentRow, feeMode?: "sponsored"): MetaMaskGaslessProtocolPins | Readonly<Record<"manager" | "delegate" | "limitedCalls" | "exactSingle", typeof MM_SINGLE_ENFORCER | MetaMaskGaslessProtocolPins["manager"]>>;
