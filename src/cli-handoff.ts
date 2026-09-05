import { ApnError } from "./errors.js";

const POSIX_SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const RAW_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export interface CliHandoff {
  readonly argv: readonly string[];
  readonly shell: string;
}

export interface CliHandoffDetails {
  readonly cli_handoff: string;
  readonly cli_handoff_argv: readonly string[];
}

export function containsRawControlCharacters(value: string): boolean {
  return RAW_CONTROL_CHARACTER.test(value);
}

export function createCliHandoff(input: readonly string[]): CliHandoff {
  if (input.length === 0 || input[0] === "") {
    throw new ApnError("APN_INTERNAL", "The foreground CLI handoff is missing its executable.");
  }
  const argv = Object.freeze([...input]);
  if (argv.some(containsRawControlCharacters)) {
    throw new ApnError("APN_INVALID_INPUT", "Foreground CLI handoff arguments cannot contain raw control characters.");
  }
  return Object.freeze({
    argv,
    shell: argv.map(renderPosixArgument).join(" "),
  });
}

export function cliHandoffDetails(handoff: CliHandoff): CliHandoffDetails {
  return {
    cli_handoff: handoff.shell,
    cli_handoff_argv: handoff.argv,
  };
}

function renderPosixArgument(value: string): string {
  if (value !== "" && POSIX_SAFE_ARGUMENT.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
