import type { CommandOption } from "./command-catalog-types.js";

/** A copyable help example: the command path and every required option with a value; `<...>` marks one the caller supplies. */
export function requiredOptionsExample(path: readonly string[], options: readonly CommandOption[], values: Readonly<Record<string, string>>): string {
  return ["apn", ...path, ...options.filter(option => option.required).flatMap(option => {
    const value = values[option.name];
    if (value === undefined) throw new Error(`No example value for ${path.join(" ")} ${option.name}.`);
    return [option.name, value];
  })].join(" ");
}
