import assert from "node:assert/strict";
import { chmod, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { runCli } from "../../src/cli.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";

const KEY = `0x${"1".padStart(64, "0")}` as const;
const ADDRESS = privateKeyToAccount(KEY).address;
const wrapping: WrappingSecretPort = {
  async load() { return Buffer.alloc(32, 7); },
  async create() { return Buffer.alloc(32, 7); },
};

async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "apn-wallet-import-")));
  const root = join(directory, "state");
  const keyFile = join(directory, "key.env");
  await writeFile(keyFile, `TEST_EVM_KEY='${KEY}'\n`, { mode: 0o600 });
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const args = (profile = "imported", expectedAddress: string = ADDRESS, path = keyFile) => [
    "wallet", "import", "--profile", profile, "--key-file", path,
    "--key-name", "TEST_EVM_KEY", "--expected-address", expectedAddress,
  ];
  const run = async (argv = args(), secret = wrapping) => await runCli(argv, {}, { stateRoot: root, wrappingSecret: secret });
  return { root, keyFile, args, run };
}

test("wallet import creates checksum metadata and equivalent local custody", async (t) => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.equal((result.data as { address: string }).address, ADDRESS);
  const state = new StateStore(f.root);
  const stored = await state.loadWallet(state.profileHash("imported"));
  assert.equal(stored?.address, ADDRESS);
  const projection = await state.loadProviderProfile(state.profileHash("imported"));
  assert.equal(projection?.provider_id, "local");
  assert.equal(projection?.public_address, ADDRESS);
  const loaded = await new EncryptedWalletStore(state, wrapping).describe("imported");
  assert.ok(loaded);
  const message = "synthetic import custody equivalence";
  assert.equal(await privateKeyToAccount(loaded.secret.privateKey).signMessage({ message }),
    await privateKeyToAccount(KEY).signMessage({ message }));
  assert.equal((await f.run()).ok, false, "retry must not overwrite a successful import");
  assert.equal((await readFile(f.keyFile, "utf8")).includes(KEY), true);
});

test("wallet import rejects unsafe file, bad key, mismatched address, and occupied state", async (t) => {
  const f = await fixture(t);
  await chmod(f.keyFile, 0o644);
  assert.equal((await f.run()).ok, false);
  await chmod(f.keyFile, 0o600);
  const link = join(f.root, "../key-link.env");
  await symlink(f.keyFile, link);
  assert.equal((await f.run(f.args("imported", ADDRESS, link))).ok, false);
  assert.equal((await f.run(f.args("imported", privateKeyToAccount(`0x${"2".padStart(64, "0")}`).address))).ok, false);
  await writeFile(f.keyFile, "TEST_EVM_KEY=0xINVALID\n", { mode: 0o600 });
  assert.equal((await f.run()).ok, false);
  await writeFile(f.keyFile, `TEST_EVM_KEY=${KEY}\n`, { mode: 0o600 });
  assert.equal((await f.run()).ok, true);
  assert.equal((await f.run(f.args("second"))).ok, false, "address collision must fail");
  assert.equal((await f.run()).ok, false, "profile collision must fail");
});

test("wallet import rejects oversized, linked, duplicated, and non-checksummed input without exposing key", async (t) => {
  const f = await fixture(t);
  const assertRejected = async () => {
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(KEY), false);
  };
  await writeFile(f.keyFile, `TEST_EVM_KEY=${KEY}\n${"#".repeat(64 * 1024)}\n`, { mode: 0o600 });
  await assertRejected();
  await writeFile(f.keyFile, `TEST_EVM_KEY=${KEY}\nTEST_EVM_KEY=${KEY}\n`, { mode: 0o600 });
  await assertRejected();
  await writeFile(f.keyFile, `TEST_EVM_KEY=${KEY}\n`, { mode: 0o600 });
  const secondLink = join(f.root, "../key-hardlink.env");
  await link(f.keyFile, secondLink);
  await assertRejected();
  await rm(secondLink);
  const result = await f.run(f.args("imported", ADDRESS.toLowerCase()));
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test("wallet import fails closed on Keychain error and partial envelope write", async (t) => {
  const f = await fixture(t);
  const broken: WrappingSecretPort = { async load() { return null; }, async create() { throw new Error("synthetic keychain unavailable"); } };
  assert.equal((await f.run(f.args(), broken)).ok, false);
  const state = new StateStore(f.root);
  await state.initialize();
  assert.equal(await state.loadEncryptedWalletEnvelope("imported"), null);
  const store = new EncryptedWalletStore(state, wrapping);
  await store.importNew("imported", KEY, ADDRESS);
  const before = await readFile(join(f.root, "wallets", "imported.json"));
  assert.equal((await f.run()).ok, false, "orphan envelope must block import retry");
  assert.equal((await runCli(["wallet", "ensure", "--profile", "imported"], {},
    { stateRoot: f.root, wrappingSecret: wrapping })).ok, false, "ensure must not repair orphan import");
  assert.deepEqual(await readFile(join(f.root, "wallets", "imported.json")), before);
});
