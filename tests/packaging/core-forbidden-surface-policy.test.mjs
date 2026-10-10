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

test("shipping scanner admits only the exact private native vendor chain argument", async t => {
  const root = await mkdtemp(join(tmpdir(), "apn-native-scanner-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts")); await mkdir(join(root, "src"));
  await copyFile("scripts/core-forbidden-surface.mjs", join(root, "scripts/core-forbidden-surface.mjs"));
  const file = join(root, "src/metamask-native-transfer-adapter.ts");
  const scan = () => spawnSync(process.execPath, [join(root, "scripts/core-forbidden-surface.mjs")], { encoding: "utf8" });
  await writeFile(file, 'const vendorArgument = "--chain-id";\n');
  assert.equal(scan().status, 0);
  await writeFile(join(root, "src/metamask-native-transfer-adapter-nearby.ts"), 'const publicArgument = "--chain-id";\n');
  let result = scan(); assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/metamask-native-transfer-adapter-nearby\.ts: --chain-id/u);
  await rm(join(root, "src/metamask-native-transfer-adapter-nearby.ts"));
  await writeFile(file, 'const vendorArgument = "--chain-id"; const tokenArgument = "--token";\n');
  result = scan(); assert.equal(result.status, 1); assert.match(result.stderr, /src\/metamask-native-transfer-adapter\.ts: --token/u);
  await writeFile(file, 'const vendorArgument = "--chain-id";\n'.repeat(501));
  result = scan(); assert.equal(result.status, 1); assert.match(result.stderr, /501 lines exceeds 500/u);
});
