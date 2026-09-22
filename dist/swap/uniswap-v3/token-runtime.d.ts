import type { CommandRequest } from "../../commands.js";
import type { UniswapTokenQuoteBuilder } from "./token-builder.js";
import { type UniswapTokenCommandRuntime, type UniswapTokenExecutionPorts } from "./token-execution.js";
import type { SavedUniswapTokenMaterialStore, UniswapTokenMaterial } from "./token-material.js";
import { UniswapTokenJournal } from "./token-operation.js";
type Prepare = Extract<CommandRequest, {
    readonly command: "swap.uniswap-token.prepare";
}>;
export interface UniswapTokenRuntimePorts extends UniswapTokenExecutionPorts {
    confirm(material: UniswapTokenMaterial): Promise<void>;
}
export declare class InstalledUniswapTokenRuntime implements UniswapTokenCommandRuntime {
    private readonly builder;
    private readonly materials;
    private readonly journal;
    private readonly ports;
    private readonly execution;
    constructor(builder: UniswapTokenQuoteBuilder, materials: SavedUniswapTokenMaterialStore, journal: UniswapTokenJournal, ports: UniswapTokenRuntimePorts);
    inventory(): {
        chain: string;
        router: "0xE592427A0AEce92De3Edee1F18E0157C05861564";
        pair: string;
        fee: number;
        mechanism: import("../pin.js").SwapMechanismPin;
        approval: string;
        transactionValue: string;
    };
    quote(request: Extract<CommandRequest, {
        readonly command: "swap.uniswap-token.quote";
    }>): Promise<unknown>;
    prepare(request: Prepare): Promise<import("./token-operation.js").UniswapTokenOperation>;
    approve(id: string): Promise<import("./token-operation.js").UniswapTokenOperation>;
    execute(id: string): Promise<import("./token-operation.js").UniswapTokenOperation>;
    status(id: string): Promise<import("./token-operation.js").UniswapTokenOperation>;
    cleanup(id: string): Promise<import("./token-operation.js").UniswapTokenOperation>;
}
export {};
