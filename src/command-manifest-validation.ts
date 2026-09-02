import { isPlainRecord } from "./canonical.js";
import type {
  ApprovalClass,
  CommandOption,
  EffectClass,
  ScalarType,
} from "./command-catalog.js";
import { OUTPUT_VERSION, PRODUCT_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";

const scalarTypes = new Set<ScalarType>(["string", "profile", "provider_id", "provider_auth_method", "positive_integer", "https_url", "address", "decimal_usdc", "atomic_usdc", "wei", "operation_id", "transaction_hash", "idempotency_key", "integer_seconds"]);
const effectClasses = new Set<EffectClass>(["none", "local_read", "network_read", "local_write", "payment_prepare", "payment_submit", "recovery"]);
const approvalClasses = new Set<ApprovalClass>(["none", "foreground_tty", "prior_profile_policy", "prior_operation_authorization"]);
const sensitivities = new Set<CommandOption["sensitivity"]>(["public", "operator_input", "sensitive_input"]);
const protectedExampleContent = /private[-_ ]?key|mnemonic|wrapping[-_ ]?secret|raw[-_ ]?signed[-_ ]?transaction|payment[-_ ]?header|reusable[-_ ]?authorization/iu;

export function validateCommandManifest(value: unknown): void {
  validateCommandManifestShape(value, PRODUCT_VERSION);
}

function validateCommandManifestShape(value: unknown, installedProductVersion?: string): void {
  if (!isPlainRecord(value) || !hasRequiredKeys(value, [
    "schema_version", "product", "product_version", "cli_envelope_version", "compatibility", "discovery", "groups", "commands",
  ])) manifestInvalid();
  if (
    value.schema_version !== "apn.command-manifest.v1" || value.product !== "agent-payment-node" ||
    !isSemanticVersion(value.product_version) ||
    (installedProductVersion !== undefined && value.product_version !== installedProductVersion) ||
    value.cli_envelope_version !== OUTPUT_VERSION
  ) manifestInvalid();
  const compatibility = recordWithKeys(value.compatibility, ["additive_optional_within_version", "breaking_change_requires_new_schema"]);
  if (compatibility.additive_optional_within_version !== true || !sameStrings(compatibility.breaking_change_requires_new_schema, [
    "field_remove_or_rename", "meaning_or_unit_change", "optional_to_required", "enum_contraction",
  ])) manifestInvalid();
  const discovery = recordWithKeys(value.discovery, ["root_text_forms", "scoped_text_forms", "machine_form", "options"]);
  if (
    !sameStrings(discovery.root_text_forms, ["apn --help", "apn help"]) ||
    !sameStrings(discovery.scoped_text_forms, ["apn <path...> --help", "apn help <path...>"]) ||
    discovery.machine_form !== "apn help --json" || !Array.isArray(discovery.options) || discovery.options.length !== 2
  ) manifestInvalid();
  for (const [index, expected] of [[0, ["--help", "flag", "root_group_or_command"]], [1, ["--json", "flag", "root_help_only"]]] as const) {
    const item = recordWithKeys(discovery.options[index], ["name", "type", "scope"]);
    if (item.name !== expected[0] || item.type !== expected[1] || item.scope !== expected[2]) manifestInvalid();
  }
  if (!Array.isArray(value.groups) || !Array.isArray(value.commands) || value.groups.length === 0 || value.commands.length === 0) manifestInvalid();
  const knownPaths = new Set<string>();
  for (const rawGroup of value.groups) {
    const group = recordWithKeys(rawGroup, ["path", "summary", "kind"]);
    const path = manifestPath(group.path);
    if (group.kind !== "group" || !nonempty(group.summary) || knownPaths.has(path)) manifestInvalid();
    knownPaths.add(path);
  }
  const commandPaths = new Set<string>();
  const recoveryTargets: string[] = [];
  for (const rawCommand of value.commands) {
    const commandValue = recordWithKeys(rawCommand, [
      "path", "synopsis", "summary", "options", "effect", "approval", "output", "states", "recovery", "examples",
    ]);
    const path = manifestPath(commandValue.path);
    if (knownPaths.has(path) || commandPaths.has(path) || !nonempty(commandValue.synopsis) || !nonempty(commandValue.summary)) manifestInvalid();
    commandPaths.add(path);
    if (!Array.isArray(commandValue.options)) manifestInvalid();
    const optionNames = new Set<string>();
    for (const rawOption of commandValue.options) {
      const manifestOption = recordWithKeys(rawOption, ["name", "type", "required", "default", "constraints", "sensitivity"]);
      if (
        typeof manifestOption.name !== "string" || !manifestOption.name.startsWith("--") || optionNames.has(manifestOption.name) ||
        !scalarTypes.has(manifestOption.type as ScalarType) || typeof manifestOption.required !== "boolean" ||
        !Array.isArray(manifestOption.constraints) || !manifestOption.constraints.every(nonempty) ||
        !sensitivities.has(manifestOption.sensitivity as CommandOption["sensitivity"])
      ) manifestInvalid();
      optionNames.add(manifestOption.name);
      const defaultValue = isPlainRecord(manifestOption.default) ? manifestOption.default : manifestInvalid();
      if (defaultValue.kind === "none") {
        if (!hasRequiredKeys(defaultValue, ["kind"])) manifestInvalid();
      } else if (defaultValue.kind === "literal") {
        if (!hasRequiredKeys(defaultValue, ["kind", "value"]) || !nonempty(defaultValue.value) || manifestOption.required) manifestInvalid();
      } else manifestInvalid();
    }
    const effect = recordWithKeys(commandValue.effect, ["class", "summary"]);
    const approval = recordWithKeys(commandValue.approval, ["class", "when"]);
    if (!effectClasses.has(effect.class as EffectClass) || !nonempty(effect.summary) || !approvalClasses.has(approval.class as ApprovalClass) || !nonempty(approval.when)) manifestInvalid();
    const output = recordWithKeys(commandValue.output, ["contract", "success_exit", "failure_exit", "success", "failures"]);
    if (!["apn.cli.v1", "text"].includes(String(output.contract)) || output.success_exit !== 0 || output.failure_exit !== 1 || !nonempty(output.success) || !Array.isArray(output.failures) || !output.failures.every(nonempty)) manifestInvalid();
    const states = recordWithKeys(commandValue.states, ["terminal", "non_terminal"]);
    if (!uniqueStrings(states.terminal) || !uniqueStrings(states.non_terminal)) manifestInvalid();
    if (!Array.isArray(commandValue.recovery)) manifestInvalid();
    for (const rawRecovery of commandValue.recovery) {
      const recovery = recordWithKeys(rawRecovery, ["command_path", "when"]);
      recoveryTargets.push(manifestPath(recovery.command_path));
      if (!nonempty(recovery.when)) manifestInvalid();
    }
    if (!Array.isArray(commandValue.examples) || commandValue.examples.length === 0 || !commandValue.examples.every(nonempty)) manifestInvalid();
    if (commandValue.examples.some((example) => /0x[0-9a-fA-F]{40}/u.test(String(example)) || protectedExampleContent.test(String(example)))) manifestInvalid();
  }
  if (recoveryTargets.some((target) => !commandPaths.has(target))) manifestInvalid();
}

export function assertCompatibleManifestEvolution(previous: unknown, next: unknown): void {
  validateCommandManifestShape(previous);
  validateCommandManifestShape(next);
  const before = previous as { readonly commands: readonly Record<string, unknown>[]; readonly groups: readonly Record<string, unknown>[]; readonly compatibility: { readonly breaking_change_requires_new_schema: readonly string[] } };
  const after = next as typeof before;
  const afterGroups = new Map(after.groups.map((group) => [manifestPath(group.path), group]));
  for (const group of before.groups) {
    const nextGroup = afterGroups.get(manifestPath(group.path));
    if (nextGroup === undefined || group.kind !== nextGroup.kind || group.summary !== nextGroup.summary) manifestInvalid();
  }
  const afterCommands = new Map(after.commands.map((commandValue) => [manifestPath(commandValue.path), commandValue]));
  for (const previousCommand of before.commands) {
    const nextCommand = afterCommands.get(manifestPath(previousCommand.path));
    if (nextCommand === undefined) manifestInvalid();
    if (JSON.stringify(commandSemantics(previousCommand)) !== JSON.stringify(commandSemantics(nextCommand))) manifestInvalid();
    const previousOptions = previousCommand.options as readonly Record<string, unknown>[];
    const nextOptions = new Map((nextCommand.options as readonly Record<string, unknown>[]).map((item) => [String(item.name), item]));
    for (const previousOption of previousOptions) {
      const nextOption = nextOptions.get(String(previousOption.name));
      if (nextOption === undefined || JSON.stringify(optionSemantics(previousOption)) !== JSON.stringify(optionSemantics(nextOption))) manifestInvalid();
    }
    for (const nextOption of nextOptions.values()) {
      if (!previousOptions.some((item) => item.name === nextOption.name) && nextOption.required === true) manifestInvalid();
    }
  }
  for (const requiredMarker of before.compatibility.breaking_change_requires_new_schema) {
    if (!after.compatibility.breaking_change_requires_new_schema.includes(requiredMarker)) manifestInvalid();
  }
}

function recordWithKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasRequiredKeys(value, keys)) return manifestInvalid();
  return value;
}

function hasRequiredKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.hasOwn(value, key));
}

function commandSemantics(value: Readonly<Record<string, unknown>>): unknown {
  const effect = value.effect as Readonly<Record<string, unknown>>;
  const approval = value.approval as Readonly<Record<string, unknown>>;
  const output = value.output as Readonly<Record<string, unknown>>;
  const states = value.states as Readonly<Record<string, unknown>>;
  const recovery = value.recovery as readonly Readonly<Record<string, unknown>>[];
  return {
    synopsis: value.synopsis,
    summary: value.summary,
    effect: { class: effect.class, summary: effect.summary },
    approval: { class: approval.class, when: approval.when },
    output: { contract: output.contract, success_exit: output.success_exit, failure_exit: output.failure_exit, success: output.success, failures: output.failures },
    states: { terminal: states.terminal, non_terminal: states.non_terminal },
    recovery: recovery.map((item) => ({ command_path: item.command_path, when: item.when })),
    examples: value.examples,
  };
}

function optionSemantics(value: Readonly<Record<string, unknown>>): unknown {
  const defaultValue = value.default as Readonly<Record<string, unknown>>;
  return {
    name: value.name,
    type: value.type,
    required: value.required,
    default: defaultValue.kind === "literal" ? { kind: defaultValue.kind, value: defaultValue.value } : { kind: defaultValue.kind },
    constraints: value.constraints,
    sensitivity: value.sensitivity,
  };
}

function manifestPath(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonempty)) return manifestInvalid();
  return value.join(" ");
}

function uniqueStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonempty) && new Set(value).size === value.length;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSemanticVersion(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(value);
}

function manifestInvalid(): never {
  throw new ApnError("APN_INTERNAL", "Command manifest validation failed.");
}
