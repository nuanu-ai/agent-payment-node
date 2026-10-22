import type { CommandOption } from "./command-catalog-types.js";
/** A copyable help example: the command path and every required option with a value; `<...>` marks one the caller supplies. */
export declare function requiredOptionsExample(path: readonly string[], options: readonly CommandOption[], values: Readonly<Record<string, string>>): string;
