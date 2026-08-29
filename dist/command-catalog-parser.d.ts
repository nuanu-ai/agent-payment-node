import { type CommandDefinition } from "./command-catalog.js";
import { ApnError } from "./errors.js";
export interface ParsedCatalogCommand {
    readonly command: CommandDefinition;
    readonly values: Readonly<Record<string, string>>;
}
export type DiscoveryDispatch = {
    readonly ok: true;
    readonly output: string;
    readonly exitCode: 0;
    readonly presentation: "text" | "json";
} | {
    readonly ok: false;
    readonly error: {
        readonly code: ApnError["code"];
        readonly message: string;
    };
    readonly nextActions: readonly string[];
    readonly exitCode: 1;
    readonly presentation: "json";
};
export declare function parseCatalogArgv(argv: readonly string[]): ParsedCatalogCommand;
export declare function parseCatalogInput(definition: CommandDefinition, input: Readonly<Record<string, unknown>>): ParsedCatalogCommand;
export declare function dispatchDiscovery(argv: readonly string[]): DiscoveryDispatch | null;
export declare function renderDiscoveryOutput(dispatch: DiscoveryDispatch): string;
export declare function catalogNextActions(argv: readonly string[]): readonly string[];
