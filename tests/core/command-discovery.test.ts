import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, readlink, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  COMMAND_GROUPS,
  COMMAND_MANIFEST,
  COMMANDS,
  assertCompatibleManifestEvolution,
  catalogNextActions,
  dispatchDiscovery,
  parseCatalogArgv,
  renderDiscoveryOutput,
  renderHelp,
  renderReadmeCommandReference,
  validateCommandManifest,
  type CommandDefinition,
  type CommandOption,
  type ScalarType,
} from "../../src/command-catalog.js";
import { runCli } from "../../src/cli.js";
import { PRODUCT_VERSION } from "../../src/constants.js";
import { ApnError } from "../../src/errors.js";
import type { NativePort } from "../../src/ports.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { inspectX402 } from "../../src/x402-http.js";
import { temporaryState } from "./helpers.js";
import { TestHttp, challengeObservation } from "./x402-helpers.js";
import { X402_PAYMENT_REQUIRED, canonicalPaymentRequiredHeader } from "./x402-vectors.js";

const EXPECTED_GROUPS = ["mcp", "doctor", "wallet", "wallet policy", "x402", "x402 fetch", "pay", "pay transfer", "operation", "receipt"];
const EXPECTED_COMMANDS = [
  "--version",
  "mcp serve",
  "mcp config",
  "doctor keychain",
  "wallet ensure",
  "wallet status",
  "wallet balance",
  "wallet policy show",
  "wallet policy set",
  "x402 inspect",
  "x402 fetch prepare",
  "x402 fetch approve",
  "pay transfer prepare",
  "pay transfer approve",
  "operation status",
  "operation resume",
  "receipt get",
];

test("one exact static catalog owns all groups, commands, recovery targets, examples and manifest fields", () => {
  assert.deepEqual(COMMAND_GROUPS.map((entry) => entry.path.join(" ")), EXPECTED_GROUPS);
  assert.deepEqual(COMMANDS.map((entry) => entry.path.join(" ")), EXPECTED_COMMANDS);
  assert.equal(COMMAND_MANIFEST.schema_version, "apn.command-manifest.v1");
  assert.equal(COMMAND_MANIFEST.product_version, PRODUCT_VERSION);
  assert.equal(COMMAND_MANIFEST.cli_envelope_version, "apn.cli.v1");
  assert.deepEqual(Object.keys(COMMAND_MANIFEST), [
    "schema_version", "product", "product_version", "cli_envelope_version", "compatibility", "discovery", "groups", "commands",
  ]);
  assert.doesNotThrow(() => validateCommandManifest(COMMAND_MANIFEST));
  const paths = new Set(EXPECTED_COMMANDS);
  for (const command of COMMANDS) {
    assert.deepEqual(Object.keys(command), ["path", "synopsis", "summary", "options", "effect", "approval", "output", "states", "recovery", "examples"]);
    assert.equal(new Set(command.options.map((option) => option.name)).size, command.options.length);
    for (const recovery of command.recovery) assert.equal(paths.has(recovery.command_path.join(" ")), true);
    for (const example of command.examples) {
      assert.doesNotMatch(example, /0x[0-9a-fA-F]{40}/u);
      assert.doesNotMatch(example, /private[-_ ]?key|mnemonic|wrapping[-_ ]?secret|raw[-_ ]?signed[-_ ]?transaction|payment[-_ ]?header/iu);
      for (const url of example.match(/https:\/\/[^ >]+/gu) ?? []) assert.match(url, /\.example(?:\/|$)/u);
    }
  }
});

test("root, every group and every leaf have identical prefix/suffix text discovery", () => {
  const rootSuffix = dispatchDiscovery(["--help"]);
  const rootPrefix = dispatchDiscovery(["help"]);
  assert.deepEqual(rootSuffix, rootPrefix);
  assert.ok(rootSuffix?.ok);
  assert.match(rootSuffix.output, /apn help --json/u);
  for (const entry of [...COMMAND_GROUPS, ...COMMANDS]) {
    const prefix = dispatchDiscovery(["help", ...entry.path]);
    const suffix = dispatchDiscovery([...entry.path, "--help"]);
    assert.deepEqual(prefix, suffix, entry.path.join(" "));
    assert.ok(prefix?.ok);
    if ("synopsis" in entry) {
      assert.match(prefix.output, new RegExp(escapeRegExp(entry.synopsis), "u"));
      assert.match(prefix.output, /Effect:/u);
      assert.match(prefix.output, /Approval:/u);
      assert.match(prefix.output, /Recovery:/u);
    } else {
      assert.match(prefix.output, /Usage:/u);
      assert.match(prefix.output, /Subgroups:/u);
      assert.match(prefix.output, /Commands:/u);
    }
  }
});

test("group help renders exact subgroup usages and complete leaf synopses", () => {
  assert.equal(renderHelp(["wallet"]), [
    "Create, inspect and configure the disposable wallet.",
    "",
    "Usage:",
    "  apn wallet <command> [options]",
    "",
    "Subgroups:",
    "  apn wallet policy <command> [options] — Inspect or change owner-approved wallet policy.",
    "",
    "Commands:",
    "  apn wallet ensure [--profile <profile>] — Create or reuse one encrypted disposable wallet.",
    "  apn wallet status [--profile <profile>] — Read wallet presence and public identity.",
    "  apn wallet balance [--profile <profile>] --rpc-url <https-url> — Read Base ETH and canonical Base-USDC balances.",
    "",
    "Machine contract: apn help --json",
    "Detailed help: apn help wallet <child>",
  ].join("\n"));
  assert.equal(renderHelp(["wallet", "policy"]), [
    "Inspect or change owner-approved wallet policy.",
    "",
    "Usage:",
    "  apn wallet policy <command> [options]",
    "",
    "Subgroups:",
    "  (none)",
    "",
    "Commands:",
    "  apn wallet policy show --profile <profile> — Read the encrypted owner-approved profile policy.",
    "  apn wallet policy set --profile <profile> --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic> [--max-balance-eth-wei <wei>] — Create, lower or raise owner-approved balance and x402 limits.",
    "",
    "Machine contract: apn help --json",
    "Detailed help: apn help wallet policy <child>",
  ].join("\n"));
});

test("machine discovery emits the exact complete manifest as one raw JSON value", () => {
  const result = dispatchDiscovery(["help", "--json"]);
  assert.ok(result?.ok);
  assert.equal(result.presentation, "json");
  assert.equal(result.output.includes("\n"), false);
  assert.deepEqual(JSON.parse(result.output), COMMAND_MANIFEST);
  assert.equal(dispatchDiscovery(["--version"]), null, "operational version remains an apn.cli.v1 command");
});

test("invalid discovery and operational usage return bounded catalog-only guidance without reflecting argv", async () => {
  const canary = "TOP_SECRET_CANARY_DO_NOT_ECHO";
  for (const argv of [
    ["help", "wallet", canary],
    ["wallet", "--help", canary],
    ["wallet", "status", "--help", "--help"],
    ["help", "--json", canary],
    ["--json"],
  ]) {
    const result = dispatchDiscovery(argv);
    assert.ok(result !== null && !result.ok);
    const envelope = JSON.parse(renderDiscoveryOutput(result)) as { next_actions: string[]; error: { code: string }; [key: string]: unknown };
    assert.equal(envelope.error.code === "APN_INVALID_INPUT" || envelope.error.code === "APN_UNSUPPORTED_COMMAND", true);
    assert.equal(JSON.stringify(envelope).includes(canary), false);
    assert.equal(envelope.next_actions.length >= 1 && envelope.next_actions.length <= 2, true);
    assert.equal(envelope.next_actions.every((action) => EXPECTED_GROUPS.some((path) => action === `apn help ${path}`) || EXPECTED_COMMANDS.some((path) => action === `apn help ${path}`) || action === "apn help"), true);
  }
  assert.deepEqual(catalogNextActions(["wallet", "status", "--profile"]), ["apn help wallet status", "apn help"]);
  assert.deepEqual(catalogNextActions([canary]), ["apn help"]);
  const operational = await runCli(["wallet", "status", "--profile"], {});
  assert.equal(operational.ok, false);
  assert.deepEqual(operational.next_actions, ["apn help wallet status", "apn help"]);
});

test("catalog parser derives requiredness, defaults, duplicate rejection and scalar constraints for every command", () => {
  for (const command of COMMANDS) {
    const argv = validArgv(command, true);
    const parsed = parseCatalogArgv(argv);
    assert.equal(parsed.command, command);
    for (const option of command.options) {
      if (option.default.kind === "literal") assert.equal(parsed.values[option.name], option.default.value);
      if (!option.required && option.default.kind === "none") assert.equal(parsed.values[option.name], validValue(option.type));
    }
    for (const required of command.options.filter((option) => option.required)) {
      assert.throws(() => parseCatalogArgv(removeOption(argv, required.name)), ApnError, `${command.path.join(" ")} ${required.name}`);
    }
    if (command.options[0] !== undefined) {
      const option = command.options[0];
      const withOption = argv.includes(option.name) ? argv : [...argv, option.name, validValue(option.type)];
      assert.throws(() => parseCatalogArgv([...withOption, option.name, validValue(option.type)]), ApnError);
      assert.throws(() => parseCatalogArgv([...command.path, option.name]), ApnError);
    }
    assert.throws(() => parseCatalogArgv([...argv, "--unknown", "value"]), ApnError);
  }
  for (const [path, option, invalidValues] of [
    [["wallet", "status"], "--profile", ["UPPER", "", "a".repeat(65)]],
    [["wallet", "balance"], "--rpc-url", ["http://rpc.example", "https://user:pass@rpc.example", "https://rpc.example/#fragment"]],
    [["pay", "transfer", "prepare"], "--to", ["0x1234", "recipient"]],
    [["pay", "transfer", "prepare"], "--amount-usdc", ["0", "01", "1.0000001"]],
    [["operation", "status"], "--operation", ["A".repeat(64), "a".repeat(63)]],
    [["operation", "resume"], "--wait-seconds", ["0", "301", "01", "1.0"]],
  ] as const) {
    const command = COMMANDS.find((entry) => entry.path.join(" ") === path.join(" ")) as CommandDefinition;
    for (const invalid of invalidValues) assert.throws(() => parseCatalogArgv(replaceOption(validArgv(command, true), option, invalid)), ApnError);
  }
});

test("catalog-declared x402 policy ceiling is enforced before request binding", () => {
  const command = COMMANDS.find((entry) => entry.path.join(" ") === "wallet policy set") as CommandDefinition;
  const argv = replaceOption(validArgv(command, true), "--max-balance-usdc-atomic", "100");
  assert.doesNotThrow(() => parseCatalogArgv(replaceOption(argv, "--max-x402-amount-atomic", "100")));
  assert.doesNotThrow(() => parseCatalogArgv(replaceOption(argv, "--max-x402-amount-atomic", "99")));
  assert.throws(
    () => parseCatalogArgv(replaceOption(argv, "--max-x402-amount-atomic", "101")),
    (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT",
  );
});

test("HTTPS parser constraints preserve RPC compatibility and match canonical bounded x402 policy", async () => {
  const longRpc = `https://rpc.example/${"r".repeat(2_100)}`;
  const noncanonicalRpc = "https://RPC.Example:443/resource";
  for (const rpcUrl of [longRpc, noncanonicalRpc]) {
    assert.doesNotThrow(() => parseCatalogArgv(["wallet", "balance", "--rpc-url", rpcUrl]));
    assert.doesNotThrow(() => new HttpsBaseRpc(rpcUrl));
  }

  const sellerPrefix = "https://seller.example/";
  const canonicalSeller = `${sellerPrefix}${"s".repeat(2_048 - Buffer.byteLength(sellerPrefix, "utf8"))}`;
  const overlongSeller = `${canonicalSeller}s`;
  const noncanonicalSeller = "https://SELLER.example:443/resource";
  assert.equal(Buffer.byteLength(canonicalSeller, "utf8"), 2_048);
  const sellerCommands = COMMANDS.filter((command) => ["x402 inspect", "x402 fetch prepare"].includes(command.path.join(" ")));
  for (const command of sellerCommands) {
    assert.doesNotThrow(() => parseCatalogArgv(replaceOption(validArgv(command, true), "--url", canonicalSeller)));
    for (const sellerUrl of [overlongSeller, noncanonicalSeller]) {
      assert.throws(() => parseCatalogArgv(replaceOption(validArgv(command, true), "--url", sellerUrl)), ApnError);
    }
  }
  const paymentRequired = {
    ...X402_PAYMENT_REQUIRED,
    resource: { ...X402_PAYMENT_REQUIRED.resource, url: canonicalSeller },
  };
  await assert.doesNotReject(inspectX402(new TestHttp(challengeObservation({
    finalUrl: canonicalSeller,
    header: canonicalPaymentRequiredHeader(paymentRequired),
  })), canonicalSeller));
  for (const sellerUrl of [overlongSeller, noncanonicalSeller]) {
    await assert.rejects(inspectX402(new TestHttp(), sellerUrl), ApnError);
  }
});

test("manifest validator and compatibility gate reject every declared structural or semantic drift class", () => {
  const additive = cloneManifest();
  Object.assign(additive, { future_optional: { enabled: true } });
  Object.assign(additive.compatibility, { future_optional: "compatible" });
  const additiveDiscovery = additive.discovery as Record<string, unknown>;
  Object.assign(additiveDiscovery, { future_optional: ["apn future help"] });
  Object.assign((additiveDiscovery.options as Array<Record<string, unknown>>)[0]!, { future_optional: true });
  Object.assign(additive.groups[0]!, { future_optional: "group metadata" });
  const additiveCommand = additive.commands.find((command) => command.path.join(" ") === "wallet status")!;
  Object.assign(additiveCommand, { future_optional: "command metadata" });
  Object.assign(additiveCommand.options[0]!, { future_optional: "option metadata" });
  Object.assign(additiveCommand.options[0]!.default, { future_optional: "default metadata" });
  Object.assign(additiveCommand.effect as Record<string, unknown>, { future_optional: "effect metadata" });
  assert.doesNotThrow(() => validateCommandManifest(additive));
  assert.doesNotThrow(() => assertCompatibleManifestEvolution(COMMAND_MANIFEST, additive));

  const previousVersion = cloneManifest();
  previousVersion.product_version = "0.2.7";
  assert.throws(() => validateCommandManifest(previousVersion), ApnError, "installed manifest validator remains version-exact");
  assert.doesNotThrow(
    () => assertCompatibleManifestEvolution(previousVersion, COMMAND_MANIFEST),
    "schema-compatible 0.2.7 to 0.2.8 evolution is permitted",
  );
  for (const invalidVersion of ["banana", "1", "01.2.3", "1.02.3", "1.2.03", "1.2.3-01"]) {
    const invalidVersionManifest = cloneManifest();
    invalidVersionManifest.product_version = invalidVersion;
    assert.throws(
      () => assertCompatibleManifestEvolution(invalidVersionManifest, COMMAND_MANIFEST),
      ApnError,
      `invalid semantic version ${invalidVersion}`,
    );
  }

  const missingField = cloneManifest();
  delete (missingField as Record<string, unknown>).product;
  assert.throws(() => validateCommandManifest(missingField), ApnError);

  const schemaChanged = cloneManifest();
  schemaChanged.schema_version = "apn.command-manifest.v2";
  assert.throws(() => assertCompatibleManifestEvolution(COMMAND_MANIFEST, schemaChanged), ApnError);

  const productChanged = cloneManifest();
  productChanged.product = "different-product";
  assert.throws(() => assertCompatibleManifestEvolution(COMMAND_MANIFEST, productChanged), ApnError);

  const duplicate = cloneManifest();
  duplicate.groups.push(structuredClone(duplicate.groups[0]!));
  assert.throws(() => validateCommandManifest(duplicate), ApnError);

  const unresolved = cloneManifest();
  unresolved.commands[0]!.recovery.push({ command_path: ["missing", "command"], when: "Never." });
  assert.throws(() => validateCommandManifest(unresolved), ApnError);

  const unsafe = cloneManifest();
  unsafe.commands[0]!.examples[0] = "apn pay --to 0x1111111111111111111111111111111111111111";
  assert.throws(() => validateCommandManifest(unsafe), ApnError);

  const removed = cloneManifest();
  removed.commands.splice(0, 1);
  assert.throws(() => assertCompatibleManifestEvolution(COMMAND_MANIFEST, removed), ApnError);

  const meaningChanged = cloneManifest();
  const profile = meaningChanged.commands.find((command) => command.path.join(" ") === "wallet status")?.options[0];
  assert.ok(profile);
  profile.type = "string";
  assert.throws(() => assertCompatibleManifestEvolution(COMMAND_MANIFEST, meaningChanged), ApnError);

  const driftFixtures: Array<{ readonly name: string; readonly manifest: ReturnType<typeof cloneManifest> }> = [];
  const groupSummaryChanged = cloneManifest();
  groupSummaryChanged.groups[0]!.summary = "Changed group meaning.";
  driftFixtures.push({ name: "group summary", manifest: groupSummaryChanged });
  const commandSummaryChanged = cloneManifest();
  commandSummaryChanged.commands[0]!.summary = "Changed command meaning.";
  driftFixtures.push({ name: "command summary", manifest: commandSummaryChanged });
  const examplesChanged = cloneManifest();
  examplesChanged.commands[0]!.examples[0] = "apn --version # changed";
  driftFixtures.push({ name: "examples", manifest: examplesChanged });
  const constraintsChanged = cloneManifest();
  constraintsChanged.commands.find((command) => command.path.join(" ") === "wallet status")!.options[0]!.constraints = ["changed_constraint"];
  driftFixtures.push({ name: "known option constraints", manifest: constraintsChanged });
  const sensitivityChanged = cloneManifest();
  sensitivityChanged.commands.find((command) => command.path.join(" ") === "wallet status")!.options[0]!.sensitivity = "operator_input";
  driftFixtures.push({ name: "known option sensitivity", manifest: sensitivityChanged });
  const defaultChanged = cloneManifest();
  const changedDefault = defaultChanged.commands.find((command) => command.path.join(" ") === "wallet status")!.options[0]!.default;
  assert.equal(changedDefault.kind, "literal");
  changedDefault.value = "other";
  driftFixtures.push({ name: "known option default", manifest: defaultChanged });
  for (const fixture of driftFixtures) {
    assert.throws(() => assertCompatibleManifestEvolution(COMMAND_MANIFEST, fixture.manifest), ApnError, fixture.name);
  }

  const requiredChanged = cloneManifest();
  const optional = requiredChanged.commands.find((command) => command.path.join(" ") === "operation resume")?.options.find((entry) => entry.name === "--wait-seconds");
  assert.ok(optional);
  optional.required = true;
  assert.throws(() => assertCompatibleManifestEvolution(COMMAND_MANIFEST, requiredChanged), ApnError);

  const enumContracted = cloneManifest();
  enumContracted.compatibility.breaking_change_requires_new_schema.pop();
  assert.throws(() => validateCommandManifest(enumContracted), ApnError);
});

test("README command block and package/build identity are mechanically identical to the catalog", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const match = /<!-- BEGIN APN COMMAND CATALOG -->\n```text\n([\s\S]*?)\n```\n<!-- END APN COMMAND CATALOG -->/u.exec(readme);
  assert.ok(match);
  assert.equal(match[1], renderReadmeCommandReference());
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { version: string };
  const packageLock = JSON.parse(await readFile(resolve("package-lock.json"), "utf8")) as { version: string; packages: Record<string, { version: string }> };
  const shrinkwrap = JSON.parse(await readFile(resolve("npm-shrinkwrap.json"), "utf8")) as typeof packageLock;
  assert.equal(packageJson.version, PRODUCT_VERSION);
  assert.equal(packageLock.version, PRODUCT_VERSION);
  assert.equal(packageLock.packages[""]?.version, PRODUCT_VERSION);
  assert.equal(shrinkwrap.version, PRODUCT_VERSION);
  assert.equal(shrinkwrap.packages[""]?.version, PRODUCT_VERSION);
});

test("actual compiled CLI ignores caller HOME and leaves effective-user APN state unchanged for an absent profile", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const entrypoint = resolve("bin/apn.js");
  const profile = `no-effect-${randomBytes(16).toString("hex")}`;
  const effectiveRoot = resolve(userInfo().homedir, ".apn");
  const before = await treeDigest(effectiveRoot);
  const result = spawnSync(entrypoint, ["wallet", "status", "--profile", profile], {
    encoding: "utf8",
    cwd: temporary.base,
    env: { ...process.env, HOME: "" },
  });
  assert.equal(result.status, 0, result.stderr ?? result.error?.message);
  assert.equal(result.stderr, "");
  const envelope = JSON.parse(result.stdout) as { readonly ok: boolean; readonly data: { readonly profile: string; readonly status: string } };
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, {
    profile,
    status: "absent",
    proof_class: "encrypted_apn_home_status",
    next_actions: ["apn wallet ensure"],
  });
  assert.equal(await treeDigest(effectiveRoot), before, "HOME is ignored by design; the effective-user ~/.apn tree must remain unchanged");
  await assert.rejects(stat(join(temporary.base, ".apn")), { code: "ENOENT" });
});

test("actual compiled discovery is raw and no-effect with empty or unwritable caller HOME", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const entrypoint = resolve("bin/apn.js");
  const effectiveRoot = resolve(userInfo().homedir, ".apn");
  const before = await treeDigest(effectiveRoot);
  const unwritableHome = join(temporary.base, "unwritable-home");
  await mkdir(unwritableHome, { mode: 0o700 });
  await chmod(unwritableHome, 0o000);
  t.after(async () => await chmod(unwritableHome, 0o700).catch(() => undefined));
  const canary = `secret-canary-${randomBytes(16).toString("hex")}`;

  for (const callerHome of ["", unwritableHome]) {
    for (const [argv, expectedOutput] of [
      [["--help"], renderHelp([])],
      [["wallet", "--help"], renderHelp(["wallet"])],
      [["help", "--json"], JSON.stringify(COMMAND_MANIFEST)],
    ] as const) {
      const result = spawnSync(entrypoint, argv, {
        encoding: "utf8",
        cwd: temporary.base,
        env: { ...process.env, HOME: callerHome },
      });
      assert.equal(result.status, 0, result.stderr ?? result.error?.message);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${expectedOutput}\n`);
      assert.equal(result.stdout.includes(canary), false);
    }

    const invalid = spawnSync(entrypoint, ["help", "wallet", canary], {
      encoding: "utf8",
      cwd: temporary.base,
      env: { ...process.env, HOME: callerHome },
    });
    assert.equal(invalid.status, 1, invalid.stderr ?? invalid.error?.message);
    assert.equal(invalid.stderr, "");
    assert.equal(invalid.stdout, `${invalid.stdout.trim()}\n`, "invalid discovery emits one raw JSON value and one terminator");
    assert.equal(invalid.stdout.includes(canary), false);
    const failure = JSON.parse(invalid.stdout) as {
      readonly version: string;
      readonly command: string;
      readonly ok: boolean;
      readonly error: { readonly code: string };
    };
    assert.equal(failure.version, "apn.cli.v1");
    assert.equal(failure.command, "invalid");
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "APN_UNSUPPORTED_COMMAND");
  }

  await chmod(unwritableHome, 0o700);
  assert.equal(await treeDigest(effectiveRoot), before, "discovery must not alter the effective-user ~/.apn tree");
  await assert.rejects(stat(join(temporary.base, ".apn")), { code: "ENOENT" });
  await assert.rejects(stat(join(unwritableHome, ".apn")), { code: "ENOENT" });
});

test("wallet status for an absent unique profile is read-only before initialization, locks, native or Keychain", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const missingRoot = join(temporary.root, "missing", ".apn");
  let nativeCalls = 0;
  const native: NativePort = { request: async () => { nativeCalls += 1; throw new Error("native must stay untouched"); } };
  const absent = await runCli(["wallet", "status", "--profile", "manifest-only-agent"], {}, { stateRoot: missingRoot, native });
  assert.equal(absent.ok, true);
  assert.deepEqual(absent.data, {
    profile: "manifest-only-agent",
    status: "absent",
    proof_class: "encrypted_apn_home_status",
    next_actions: ["apn wallet ensure"],
  });
  assert.equal(nativeCalls, 0);
  await assert.rejects(stat(missingRoot), { code: "ENOENT" });

  const state = new StateStore(temporary.root);
  await state.initialize();
  const locksBefore = await readdir(join(temporary.root, "locks"));
  const initialized = await runCli(["wallet", "status", "--profile", "another-absent-agent"], {}, { stateRoot: temporary.root, native });
  assert.equal(initialized.ok, true);
  assert.equal((initialized.data as { status: string }).status, "absent");
  assert.deepEqual(await readdir(join(temporary.root, "locks")), locksBefore);
  assert.equal(nativeCalls, 0);

  const unsafeRoot = join(temporary.base, "unsafe-state");
  await mkdir(unsafeRoot, { mode: 0o755 });
  const unsafe = await runCli(["wallet", "status", "--profile", "unsafe-root-agent"], {}, { stateRoot: unsafeRoot, native });
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.error?.code, "APN_STATE_SECURITY");
  assert.equal(nativeCalls, 0);
});

function validArgv(command: CommandDefinition, includeOptional: boolean): string[] {
  const argv = [...command.path];
  for (const option of command.options) {
    if (option.required || (includeOptional && option.default.kind === "none")) argv.push(option.name, validValue(option.type));
  }
  return argv;
}

function validValue(type: ScalarType): string {
  switch (type) {
    case "string": return "value";
    case "profile": return "agent_1";
    case "https_url": return "https://rpc.example/resource";
    case "address": return "0x1111111111111111111111111111111111111111";
    case "decimal_usdc": return "0.01";
    case "atomic_usdc": return "100";
    case "wei": return "100";
    case "operation_id": return "a".repeat(64);
    case "idempotency_key": return "example-001";
    case "integer_seconds": return "60";
  }
}

function removeOption(argv: readonly string[], name: string): string[] {
  const index = argv.indexOf(name);
  assert.notEqual(index, -1);
  return [...argv.slice(0, index), ...argv.slice(index + 2)];
}

function replaceOption(argv: readonly string[], name: string, value: string): string[] {
  const next = [...argv];
  const index = next.indexOf(name);
  if (index === -1) next.push(name, value);
  else next[index + 1] = value;
  return next;
}

function cloneManifest(): {
  groups: Array<{ path: string[]; summary: string; kind: "group" }>;
  commands: Array<{ path: string[]; synopsis: string; summary: string; options: Array<CommandOption & { type: ScalarType; required: boolean; constraints: string[]; sensitivity: CommandOption["sensitivity"]; default: { kind: "none"; value?: string } | { kind: "literal"; value: string } }>; effect: unknown; approval: unknown; output: unknown; states: unknown; recovery: Array<{ command_path: string[]; when: string }>; examples: string[] }>;
  compatibility: { additive_optional_within_version: boolean; breaking_change_requires_new_schema: string[] };
  discovery: Record<string, unknown>;
  [key: string]: unknown;
} {
  return structuredClone(COMMAND_MANIFEST) as never;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function treeDigest(root: string): Promise<string> {
  const rows: unknown[] = [];
  const visit = async (path: string, relativePath: string): Promise<void> => {
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && relativePath === "") {
        rows.push({ path: ".", type: "absent" });
        return;
      }
      throw error;
    }
    const mode = stats.mode & 0o7777;
    if (stats.isSymbolicLink()) {
      rows.push({ path: relativePath || ".", type: "symlink", mode, target: await readlink(path) });
      return;
    }
    if (stats.isDirectory()) {
      rows.push({ path: relativePath || ".", type: "directory", mode });
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), relativePath === "" ? name : join(relativePath, name));
      return;
    }
    if (stats.isFile()) {
      const bytes = await readFile(path);
      rows.push({ path: relativePath, type: "file", mode, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
      return;
    }
    rows.push({ path: relativePath, type: "other", mode, size: stats.size });
  };
  await visit(root, "");
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
