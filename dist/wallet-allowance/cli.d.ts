import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
import { StateStore } from "../state.js";
import { type WalletAllowanceRpc } from "./chain.js";
/** `apn wallet allowance revoke|status`; MCP runs status and reaches revoke only as a CLI handoff. */
export declare function executeWalletAllowanceCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope>;
/** The chain's own `APN_<CHAIN>_RPC_URL`; a chain APN names no setting for, or an unset one, is refused by name. */
export declare function walletAllowanceRpc(chainId: number, state: StateStore, options: Pick<RuntimeFactoryOptions, "walletAllowanceRpc">, environment?: Readonly<Record<string, string | undefined>>): {
    readonly rpcSetting: string;
    readonly rpc: WalletAllowanceRpc;
};
