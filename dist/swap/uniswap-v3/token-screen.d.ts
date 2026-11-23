import type { UniswapTokenOperation } from "./token-operation.js";
/** The Ethereum token lane's foreground screens, byte for byte as the lane has always shown them. */
export declare function ethereumTokenScreen(op: UniswapTokenOperation, cleanup: boolean): readonly string[];
