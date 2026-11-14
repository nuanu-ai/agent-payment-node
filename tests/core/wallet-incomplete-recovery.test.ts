/**
 * QA on 0.5.106 (F22): a `wallet ensure` or `wallet import` interrupted after the encrypted key was sealed and before
 * `wallet.json` left `wallet status` answering `absent` with `apn wallet ensure`, while ensure and import refused the
 * profile with APN_PROFILE_DRIFT. The key is kept; status now names the incomplete state and the one command that
 * completes it from that sealed key alone, and no provider can be bound over that key. QA on 0.5.104 (F02):
 * `wallet status --profile s1` advised `apn wallet ensure` without the profile, which created `default` and left `s1`
 * absent.
 */
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import type { CommandRequest, OutputEnvelope } from "../../src/commands.js";
import { ApnCore } from "../../src/core.js";
import { EncryptedWalletStore, walletEnvelopeIdentity, type WalletIdentity } from "../../src/encrypted-wallet-store.js";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { WalletRecord } from "../../src/model.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import type { ForegroundAuthenticationPort, ProviderRegistryPort } from "../../src/provider-ports.js";
import { StateStore } from "../../src/state.js";
import { TestNative, TestProfilePolicy, TestRpc, WALLET, makeCore, temporaryState } from "./helpers.js";

const MASTER = Buffer.from("11".repeat(32), "hex");
const WRONG_MASTER = Buffer.from("22".repeat(32), "hex");
const PROFILE = "s1";
const KEY = `0x${"1".padStart(64, "0")}` as const;
const ADDRESS = privateKeyToAccount(KEY).address;
const OTHER_KEY = `0x${"2".padStart(64, "0")}` as const;
const OTHER_ADDRESS = privateKeyToAccount(OTHER_KEY).address;
const COMPLETE = `apn wallet ensure --profile ${PROFILE}`;

class TestWrappingSecret implements WrappingSecretPort {
  value: Buffer | null;
  creates = 0;
  constructor(value: Buffer | null = MASTER) { this.value = value === null ? null : Buffer.from(value); }
  async load(): Promise<Buffer | null> { return this.value === null ? null : Buffer.from(this.value); }
  async create(): Promise<Buffer> {
    this.creates += 1;
    this.value ??= Buffer.from(MASTER);
    return Buffer.from(this.value);
  }
}

/** The process stops right after native custody sealed the key: the public record is never written. */
class StopBeforePublicRecord extends StateStore {
  override async writeWallet(wallet: WalletRecord): Promise<void> {
    // The stopped write may already have made the record's directory; it is left empty.
    await this.ensureDirectory(join("wallets", wallet.profileHash));
    throw new Error("synthetic interruption before wallet.json");
  }
  override async writeNewWallet(_wallet: WalletRecord): Promise<void> {
    throw new Error("synthetic interruption before wallet.json");
  }
}

async function interrupted(root: string, wrapping: WrappingSecretPort, request: CommandRequest): Promise<void> {
  const state = new StopBeforePublicRecord(root);
  const core = new ApnCore({ state, native: new LocalWalletNative(state, wrapping), profileRepository: new StateProfileRepository(state) });
  const result = await core.execute(request);
  assert.equal(result.ok, false, "the run is interrupted");
}

async function fixture(t: test.TestContext, wrapping: TestWrappingSecret) {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const keyFile = join(temporary.base, "key.env"), otherKeyFile = join(temporary.base, "other.env");
  await writeFile(keyFile, `TEST_EVM_KEY=${KEY}\n`, { mode: 0o600 });
  await writeFile(otherKeyFile, `TEST_EVM_KEY=${OTHER_KEY}\n`, { mode: 0o600 });
  const root = temporary.root, state = new StateStore(root), profileHash = state.profileHash(PROFILE);
  const envelopePath = join(root, "wallets", `${PROFILE}.json`);
  return {
    root, state, profileHash, envelopePath, keyFile, otherKeyFile,
    cli: async (argv: readonly string[], secret: WrappingSecretPort = wrapping): Promise<OutputEnvelope> =>
      await runCli(argv, {}, { stateRoot: root, wrappingSecret: secret }),
    importArgs: (file: string, address: string) => ["wallet", "import", "--profile", PROFILE, "--key-file", file,
      "--key-name", "TEST_EVM_KEY", "--expected-address", address],
    importRequest: (): CommandRequest => ({ command: "wallet.import", profile: PROFILE, keyFile, keyName: "TEST_EVM_KEY", expectedAddress: ADDRESS }),
    sealed: async (): Promise<{ readonly bytes: Buffer; readonly identity: WalletIdentity }> => {
      const bytes = await readFile(envelopePath);
      return { bytes, identity: walletEnvelopeIdentity(JSON.parse(bytes.toString("utf8")), PROFILE) };
    },
  };
}

/** A next action is run exactly as printed. */
function argv(command: string | undefined): readonly string[] {
  if (command === undefined || !command.startsWith("apn ")) throw new Error(`not an apn command: ${String(command)}`);
  return command.split(" ").slice(1);
}

function assertIncomplete(status: OutputEnvelope): void {
  assert.equal(status.ok, true, JSON.stringify(status.error));
  const data = status.data as Record<string, unknown>;
  assert.equal(data.profile, PROFILE);
  assert.equal(data.status, "incomplete");
  assert.equal(data.reason, "sealed_key_without_public_record");
  assert.equal("address" in data, false, "status decrypts nothing, so it shows no unproven address");
  assert.deepEqual(data.next_actions, [COMPLETE]);
  assert.deepEqual(status.next_actions, [COMPLETE]);
}

test("an ensure stopped after sealing its key: status says incomplete for that profile and ensure completes it from the sealed key alone", async (t) => {
  const wrapping = new TestWrappingSecret(null);
  const f = await fixture(t, wrapping);
  await interrupted(f.root, wrapping, { command: "wallet.ensure", profile: PROFILE });
  const sealed = await f.sealed();
  assert.equal(await f.state.loadWallet(f.profileHash), null);
  assert.deepEqual(await readdir(join(f.root, "wallets", f.profileHash)), [], "the stopped record write left its directory empty");
  assert.equal(wrapping.creates, 1);

  const status = await f.cli(["wallet", "status", "--profile", PROFILE]);
  assertIncomplete(status);
  // Its empty record directory fails closed in the local-wallet scan of another profile, naming the command that completes it.
  const elsewhere = ["wallet", "import", "--profile", "other", "--key-file", f.keyFile, "--key-name", "TEST_EVM_KEY", "--expected-address", ADDRESS];
  const blocked = await f.cli(elsewhere);
  assert.equal(blocked.error?.code, "APN_STATE_CORRUPT");
  assert.equal(blocked.error?.details?.reason, "sealed_key_without_public_record");
  assert.deepEqual(blocked.next_actions, [COMPLETE]);
  const completed = await f.cli(argv(status.next_actions[0]));
  assert.equal(completed.ok, true, JSON.stringify(completed.error));
  const data = completed.data as Record<string, unknown>;
  assert.deepEqual([data.status, data.address, data.created_at, data.binding_hash],
    ["ready", sealed.identity.address, sealed.identity.createdAt, sealed.identity.bindingHash]);
  assert.deepEqual(await readFile(f.envelopePath), sealed.bytes, "the sealed key is reused, never replaced by a second key");
  assert.equal(wrapping.creates, 1, "no wrapping secret is minted");
  assert.deepEqual((await readdir(join(f.root, "wallets"))).sort(), [f.profileHash, `${PROFILE}.json`].sort(), "no default profile");
  assert.equal((await f.state.loadWallet(f.profileHash))?.address, sealed.identity.address);
  const projection = await f.state.loadProviderProfile(f.profileHash);
  assert.deepEqual([projection?.provider_id, projection?.public_address, projection?.account_binding_hash],
    ["local", sealed.identity.address, sealed.identity.bindingHash]);

  for (const command of [["wallet", "status", "--profile", PROFILE], ["wallet", "ensure", "--profile", PROFILE]]) {
    const again = await f.cli(command);
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.deepEqual([(again.data as Record<string, unknown>).status, (again.data as Record<string, unknown>).address],
      ["ready", sealed.identity.address]);
  }
  assert.deepEqual(await readFile(f.envelopePath), sealed.bytes);
  const imported = await f.cli(elsewhere);
  assert.equal(imported.ok, true, `the completed wallet no longer blocks other profiles: ${JSON.stringify(imported.error)}`);
});

test("no provider is bound over an incomplete local wallet: connect and a Coinbase Solana account refuse before any contact or write", async (t) => {
  const wrapping = new TestWrappingSecret();
  const f = await fixture(t, wrapping);
  await interrupted(f.root, wrapping, { command: "wallet.ensure", profile: PROFILE });
  const sealed = await f.sealed();
  const contacted: string[] = [];
  const registry: ProviderRegistryPort = { resolve: (providerId) => { contacted.push(providerId); throw new Error("no provider may be reached"); } };
  const foreground: ForegroundAuthenticationPort = {
    readIdentity: async () => { contacted.push("identity"); throw new Error("no consent may start"); },
    readChallengeResponse: async () => { contacted.push("challenge"); throw new Error("no consent may start"); },
    confirmRebind: async () => { contacted.push("rebind"); return false; },
  };
  const core = (root: string) => {
    const state = new StateStore(root);
    return new ApnCore({ state, native: new LocalWalletNative(state, wrapping), profileRepository: new StateProfileRepository(state),
      providerRegistry: registry, foregroundAuthentication: foreground });
  };
  const requests: readonly CommandRequest[] = [
    { command: "wallet.connect", profile: PROFILE, providerId: "coinbase-agentic-wallet" },
    { command: "wallet.connect", profile: PROFILE, providerId: "metamask-agent-wallet", authenticationMethod: "browser" },
    { command: "wallet.connect", profile: PROFILE, providerId: "metamask-smart-account", authenticationMethod: "browser",
      permissionCapUsdcAtomic: "2000000", permissionExpiresAt: 2_000_000_000, idempotencyKey: "incomplete-connect-0001" },
    { command: "wallet.ensure-solana", profile: PROFILE, provider: "coinbase-awal", acceptRisk: false },
  ];
  for (const request of requests) {
    const refused = await core(f.root).execute(request);
    const label = JSON.stringify(request);
    assert.equal(refused.error?.code, "APN_PROFILE_DRIFT", label);
    assert.equal(refused.error?.details?.reason, "sealed_key_without_public_record", label);
    assert.deepEqual(refused.next_actions, [COMPLETE], label);
  }
  assert.deepEqual(contacted, [], "no provider was resolved and no consent started");
  assert.equal(await f.state.loadProviderProfile(f.profileHash), null, "no provider profile was written");
  assert.deepEqual((await readdir(f.root)).filter((name) => ["chain-accounts", "chain-wallets", "smart-account-permissions"].includes(name)), []);
  assert.deepEqual(await readFile(f.envelopePath), sealed.bytes);

  // The one next action completes the local wallet; a profile without an incomplete key still reaches its provider.
  const completed = await f.cli(argv(COMPLETE));
  assert.equal((completed.data as Record<string, unknown>).address, sealed.identity.address);
  const other = await core(f.root).execute({ command: "wallet.connect", profile: "fresh", providerId: "coinbase-agentic-wallet" });
  assert.notEqual(other.error?.details?.reason, "sealed_key_without_public_record");
  assert.deepEqual(contacted, ["coinbase-agentic-wallet"]);
});

test("an import stopped after sealing its key completes only with that very key; another key is refused and changes nothing", async (t) => {
  const wrapping = new TestWrappingSecret();
  const f = await fixture(t, wrapping);
  await interrupted(f.root, wrapping, f.importRequest());
  const sealed = await f.sealed();
  assert.equal(sealed.identity.address, ADDRESS);
  assertIncomplete(await f.cli(["wallet", "status", "--profile", PROFILE]));

  const other = await f.cli(f.importArgs(f.otherKeyFile, OTHER_ADDRESS));
  assert.equal(other.ok, false);
  assert.equal(other.error?.code, "APN_PROFILE_DRIFT");
  assert.equal(other.error?.details?.reason, "incomplete_wallet_key_differs");
  assert.equal(other.next_actions[0], COMPLETE);
  assert.equal(JSON.stringify(other).includes(KEY.slice(2)) || JSON.stringify(other).includes(OTHER_KEY.slice(2)), false);
  assert.equal(await f.state.loadWallet(f.profileHash), null);
  assert.deepEqual(await readFile(f.envelopePath), sealed.bytes);

  const same = await f.cli(f.importArgs(f.keyFile, ADDRESS));
  assert.equal(same.ok, true, JSON.stringify(same.error));
  const data = same.data as Record<string, unknown>;
  assert.deepEqual([data.status, data.address, data.created_at, data.binding_hash],
    ["ready", ADDRESS, sealed.identity.createdAt, sealed.identity.bindingHash]);
  assert.deepEqual(await readFile(f.envelopePath), sealed.bytes, "completion rewrites no sealed key");
  assert.equal((await f.state.loadProviderProfile(f.profileHash))?.public_address, ADDRESS);
  const custody = new EncryptedWalletStore(f.state, wrapping), loaded = await custody.describe(PROFILE);
  try { assert.equal(loaded?.secret.privateKey, KEY, "the sealed key is the imported one"); }
  finally { if (loaded !== null) custody.clear(loaded.secret); }

  const retry = await f.cli(f.importArgs(f.keyFile, ADDRESS));
  assert.equal(retry.error?.code, "APN_PROFILE_DRIFT", "a complete wallet is never overwritten");
  assert.equal(wrapping.creates, 0);
});

test("wallet ensure also completes a stopped import from its sealed key, creating no other key", async (t) => {
  const wrapping = new TestWrappingSecret();
  const f = await fixture(t, wrapping);
  await interrupted(f.root, wrapping, f.importRequest());
  const sealed = await f.sealed();
  const completed = await f.cli(["wallet", "ensure", "--profile", PROFILE]);
  assert.equal(completed.ok, true, JSON.stringify(completed.error));
  assert.equal((completed.data as Record<string, unknown>).address, ADDRESS);
  assert.deepEqual(await readFile(f.envelopePath), sealed.bytes);
  assert.equal(wrapping.creates, 0);
});

test("completion needs proof from the sealed key: a missing or wrong wrapping secret or a forged envelope header writes nothing", async (t) => {
  const wrapping = new TestWrappingSecret();
  const f = await fixture(t, wrapping);
  await interrupted(f.root, wrapping, { command: "wallet.ensure", profile: PROFILE });
  const sealed = await f.sealed();

  const missing = new TestWrappingSecret(null);
  for (const command of [["wallet", "status", "--profile", PROFILE], ["wallet", "ensure", "--profile", PROFILE]]) {
    const refused = await f.cli(command, missing);
    assert.equal(refused.error?.code, "APN_STATE_CORRUPT", command.join(" "));
    assert.equal(refused.error?.details?.reason, "wrapping_secret_missing", command.join(" "));
    assert.match(refused.next_actions[0] ?? "", /^Restore the login Keychain item /u);
  }
  assert.equal(missing.creates, 0, "a missing secret is never replaced over a sealed key");

  const wrong = await f.cli(["wallet", "ensure", "--profile", PROFILE], new TestWrappingSecret(WRONG_MASTER));
  assert.equal(wrong.error?.code, "APN_STATE_CORRUPT");

  // A header that names another address (with a matching binding hash) does not authenticate under the secret.
  const forged = JSON.parse(sealed.bytes.toString("utf8")) as { identity: { address: string; createdAt: string; bindingHash: string } };
  forged.identity.address = OTHER_ADDRESS;
  forged.identity.bindingHash = hashObject({ profile: PROFILE, address: OTHER_ADDRESS, createdAt: forged.identity.createdAt });
  await writeFile(f.envelopePath, `${canonicalJson(forged)}\n`, { encoding: "utf8", mode: 0o600 });
  const refused = await f.cli(["wallet", "ensure", "--profile", PROFILE]);
  assert.equal(refused.error?.code, "APN_STATE_CORRUPT");
  assert.equal(JSON.stringify(refused).includes(OTHER_ADDRESS), false);

  assert.equal(await f.state.loadWallet(f.profileHash), null);
  assert.equal(await f.state.loadProviderProfile(f.profileHash), null);
  await writeFile(f.envelopePath, sealed.bytes, { mode: 0o600 });
  const completed = await f.cli(["wallet", "ensure", "--profile", PROFILE]);
  assert.equal((completed.data as Record<string, unknown>).address, sealed.identity.address);
  assert.equal(wrapping.creates, 0);
});

test("wallet next actions name the profile asked about, so running them never creates the default profile", async (t) => {
  const wrapping = new TestWrappingSecret(null);
  const f = await fixture(t, wrapping);
  const absent = await f.cli(["wallet", "status", "--profile", PROFILE]);
  assert.deepEqual(absent.data, { profile: PROFILE, status: "absent", proof_class: "encrypted_apn_home_status", next_actions: [COMPLETE] });
  assert.deepEqual(absent.next_actions, [COMPLETE]);
  const created = await f.cli(argv(absent.next_actions[0]));
  assert.equal(created.ok, true, JSON.stringify(created.error));
  assert.equal((created.data as Record<string, unknown>).profile, PROFILE);
  assert.equal(((await f.cli(["wallet", "status", "--profile", PROFILE])).data as Record<string, unknown>).status, "ready");
  assert.equal(((await f.cli(["wallet", "status", "--profile", "default"])).data as Record<string, unknown>).status, "absent");
  assert.equal((await readdir(join(f.root, "wallets"))).includes("default.json"), false);

  // The balance re-read names the profile too.
  const balanceRoot = join(f.root, "..", "balance-state");
  await makeCore({ root: balanceRoot, native: new TestNative() }).execute({ command: "wallet.ensure", profile: PROFILE });
  const rpc = new TestRpc();
  rpc.balances = { ...rpc.balances, address: WALLET };
  const balance = await makeCore({ root: balanceRoot, rpc, policy: new TestProfilePolicy() }).execute({ command: "wallet.balance", profile: PROFILE });
  assert.equal(balance.ok, true, JSON.stringify(balance.error));
  assert.equal(balance.next_actions.at(-1), `Re-run apn wallet balance --profile ${PROFILE}`);
});
