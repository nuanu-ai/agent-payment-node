import { randomUUID } from "node:crypto";
import { bindArgv, type BoundCommand } from "./command-binder.js";
import { catalogNextActions } from "./command-catalog.js";
import type { OutputEnvelope } from "./commands.js";
import { OUTPUT_VERSION } from "./constants.js";
import { asApnError } from "./errors.js";
import {
  effectiveStateRoot,
  executeBoundCommand,
  type RuntimeFactoryOptions,
} from "./runtime-factory.js";

export type CliRuntimeOptions = RuntimeFactoryOptions;
export { effectiveStateRoot };

export function parseArgv(argv: readonly string[]): BoundCommand {
  return bindArgv(argv);
}

export async function runCli(
  argv: readonly string[],
  _environment: NodeJS.ProcessEnv = process.env,
  options: CliRuntimeOptions = {},
): Promise<OutputEnvelope> {
  try {
    return await executeBoundCommand(parseArgv(argv), options);
  } catch (error) {
    const safe = asApnError(error);
    return {
      version: OUTPUT_VERSION,
      request_id: randomUUID(),
      command: "invalid",
      ok: false,
      proof_class: "classified_failure",
      data: null,
      operation: null,
      receipt: null,
      error: { code: safe.code, message: safe.message, ...(safe.details === undefined ? {} : { details: safe.details }) },
      next_actions: catalogNextActions(argv),
    };
  }
}
