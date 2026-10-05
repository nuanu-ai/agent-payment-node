import type { ApprovalClass, CommandDefinition, CommandOption, EffectClass, ScalarType } from "./command-catalog-types.js";

export function command(
  path: readonly string[],
  synopsis: string,
  summary: string,
  options: readonly CommandOption[],
  effectClass: EffectClass,
  effectSummary: string,
  approvalClass: ApprovalClass,
  approvalWhen: string,
  states: CommandDefinition["states"],
  recovery: CommandDefinition["recovery"],
  examples: readonly string[],
  outputContract: CommandDefinition["output"]["contract"] = "apn.cli.v1",
): CommandDefinition {
  return {
    path,
    synopsis,
    summary,
    options,
    effect: { class: effectClass, summary: effectSummary },
    approval: { class: approvalClass, when: approvalWhen },
    output: {
      contract: outputContract,
      success_exit: 0,
      failure_exit: 1,
      success: outputContract === "apn.cli.v1" ? "One successful apn.cli.v1 envelope." : "The command-specific raw transport output.",
      failures: [outputContract === "apn.cli.v1" ? "One classified-failure apn.cli.v1 envelope." : "A classified command failure."],
    },
    states,
    recovery,
    examples,
  };
}
export function option(
  name: `--${string}`,
  type: ScalarType,
  required: boolean,
  defaultValue: CommandOption["default"],
  constraints: readonly string[],
  sensitivity: CommandOption["sensitivity"],
): CommandOption {
  return { name, type, required, default: defaultValue, constraints, sensitivity };
}
