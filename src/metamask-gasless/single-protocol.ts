import type { MetaMaskGaslessDeploymentRow, MetaMaskGaslessProtocolPins } from "./model.js";
import { mmFail } from "./reasons.js";

/** Stock delegation-framework 1.3.0; selected only by the explicit sponsored schema. */
export const MM_SINGLE_ENFORCER = Object.freeze({
  address: "0x146713078d39ecc1f5338309c28405ccf85abfbb",
  codeHash: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e",
} as const);
export function mmProtocolPins(row: MetaMaskGaslessDeploymentRow, feeMode?: "sponsored"): MetaMaskGaslessProtocolPins |
  Readonly<Record<"manager" | "delegate" | "limitedCalls" | "exactSingle", typeof MM_SINGLE_ENFORCER | MetaMaskGaslessProtocolPins["manager"]>> {
  if (feeMode !== undefined && feeMode !== "sponsored") mmFail("mm_gasless_state_corrupt");
  if (feeMode === "sponsored") return { manager: row.protocol.manager, delegate: row.protocol.delegate,
    limitedCalls: row.protocol.limitedCalls, exactSingle: MM_SINGLE_ENFORCER };
  return row.protocol;
}
