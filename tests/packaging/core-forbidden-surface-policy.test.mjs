import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("shipping scanner grants only the audited USDT custody path and preserves other forbidden rules", async t => {
  const root = await mkdtemp(join(tmpdir(), "apn-scanner-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await copyFile("scripts/core-forbidden-surface.mjs", join(root, "scripts/core-forbidden-surface.mjs"));
  const writeSource = async (path, source) => {
    const file = join(root, "src", path);
    await mkdir(dirname(file), { recursive: true }); await writeFile(file, source);
  };
  const scan = () => spawnSync(process.execPath, [join(root, "scripts/core-forbidden-surface.mjs")], { encoding: "utf8" });
  await writeSource("gasless-usdt/local-signing.ts", "account.signTypedData(frozenOperation);\n");
  assert.equal(scan().status, 0);
  await writeSource("gasless-usdt/nearby-signing.ts", "account.signTypedData(arbitraryInput);\n");
  await writeSource("arbitrary-signer.ts", "account.signTypedData(arbitraryInput);\n");
  let result = scan();
  assert.equal(result.status, 1); assert.match(result.stderr, /src\/gasless-usdt\/nearby-signing\.ts: signTypedData/u);
  assert.match(result.stderr, /src\/arbitrary-signer\.ts: signTypedData/u);
  await writeSource("gasless-usdt/nearby-signing.ts", "export {};\n");
  await writeSource("arbitrary-signer.ts", "export {};\n");
  await writeSource("gasless-usdt/local-signing.ts", "account.signTypedData(frozenOperation);\naccount.signMessage(input);\n");
  result = scan();
  assert.equal(result.status, 1); assert.match(result.stderr, /src\/gasless-usdt\/local-signing\.ts: signMessage/u);
  await writeSource("gasless-usdt/local-signing.ts", "account.signTypedData(frozenOperation);\n".repeat(501));
  result = scan();
  assert.equal(result.status, 1); assert.match(result.stderr, /501 lines exceeds 500/u);
});

test("shipping scanner admits the vendor chain argument only in the x402 adapter, not in the native transfer or revoke send", async t => {
  const root = await mkdtemp(join(tmpdir(), "apn-native-scanner-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts")); await mkdir(join(root, "src/metamask-gasless/revocation"), { recursive: true });
  await copyFile("scripts/core-forbidden-surface.mjs", join(root, "scripts/core-forbidden-surface.mjs"));
  const scan = () => spawnSync(process.execPath, [join(root, "scripts/core-forbidden-surface.mjs")], { encoding: "utf8" });
  // The x402 adapter's own required vendor arguments, each on its own line.
  const x402 = ['"wallet", "select"', '"--chain-namespace", "evm"', '"wallet", "sign-typed-data"', '"--chain-id", input.chainId',
    '"--payload", payload', '"--intent", input.humanIntent', '"wallet", "requests", "watch"'].map(argv => `run([${argv}]);\n`).join("");
  const file = join(root, "src/metamask-x402-adapter.ts");
  await writeFile(file, x402);
  assert.equal(scan().status, 0);
  await writeFile(join(root, "src/metamask-x402-adapter-nearby.ts"), 'const publicArgument = "--chain-id";\n');
  let result = scan(); assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/metamask-x402-adapter-nearby\.ts: --chain-id/u);
  await rm(join(root, "src/metamask-x402-adapter-nearby.ts"));
  // 0.5.108: the native transfer and the delegation disable no longer hand a chain id to `mm`.
  for (const [path, pattern] of [["src/metamask-native-transfer-adapter.ts", /src\/metamask-native-transfer-adapter\.ts: --chain-id/u],
    ["src/metamask-gasless/revocation/wallet.ts", /src\/metamask-gasless\/revocation\/wallet\.ts: --chain-id/u]]) {
    await writeFile(join(root, path), 'const vendorArgument = "--chain-id";\n');
    result = scan(); assert.equal(result.status, 1); assert.match(result.stderr, pattern);
    await rm(join(root, path));
  }
  assert.equal(scan().status, 0);
  await writeFile(file, `${x402}const tokenArgument = "--token";\n`);
  result = scan(); assert.equal(result.status, 1); assert.match(result.stderr, /src\/metamask-x402-adapter\.ts: --token/u);
  await writeFile(file, x402 + "export {};\n".repeat(501));
  result = scan(); assert.equal(result.status, 1); assert.match(result.stderr, /508 lines exceeds 500/u);
});
