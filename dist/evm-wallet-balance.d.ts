import { type EvmAssetSelection } from "./evm-asset.js";
import type { RuntimeContext } from "./runtime.js";
export declare function evmWalletBalance(context: RuntimeContext, profileInput: string, selection: EvmAssetSelection): Promise<unknown>;
