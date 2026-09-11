import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { encodeAbiParameters, getAddress, hashDomain, keccak256, parseAbiParameters } from "viem";
import type { Hex } from "viem";
import type { GaslessDeployment } from "../../src/gasless/model.js";
import { GASLESS_DEPLOYMENTS } from "../../src/gasless/registry.js";

type Provenance = Readonly<{
  requestFile?: string;
  requestFileSha256?: string;
  responseFile?: string;
  responseFileSha256?: string;
  responseId?: number;
  method?: string;
  blockHash?: string | null;
  summaryFile?: string;
  summaryFileSha256?: string;
  observation?: string;
}>;
type Runtime = Readonly<{
  address: string;
  bytes: number;
  keccak256: Hex;
  raw?: Hex;
  provenance: Provenance;
}>;
type Slot = Readonly<{ slot: Hex; word: Hex; provenance: Provenance }>;
type Fixture = Readonly<{
  schema: string;
  evidenceBoundary: string;
  chainId: number;
  network: string;
  token: Readonly<{
    address: string;
    proxyRuntime: Runtime;
    implementationSlot: Slot;
    implementationRuntime: Runtime;
    signatureCheckerRuntime: Runtime;
    domain: Readonly<{ name: string; version: string; decimals: number; separator: Hex; provenance: Provenance }>;
  }>;
  paymasterProxyRuntime: Runtime;
  paymasterImplementationSlot: Slot;
  paymasterImplementationRuntime: Runtime;
  entryPointRuntime: Runtime;
  delegateRuntime: Runtime;
}>;

const CHAIN_IDS = [1, 10, 130, 137, 8453, 42161, 43114] as const;
const DOMAIN_TYPES = { EIP712Domain: [
  { name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
] } as const;

async function fixtures(): Promise<readonly Fixture[]> {
  const directory = resolve("tests/core/gasless-fixtures");
  const names = (await readdir(directory)).filter((name) => /^deployment-.*\.json$/u.test(name)).sort();
  const rows = await Promise.all(names.map(async (name) => JSON.parse(
    await readFile(resolve(directory, name), "utf8"),
  ) as Fixture));
  return rows.sort((left, right) => left.chainId - right.chainId);
}

function runtimes(fixture: Fixture): readonly Runtime[] {
  return [fixture.token.proxyRuntime, fixture.token.implementationRuntime, fixture.token.signatureCheckerRuntime,
    fixture.entryPointRuntime, fixture.delegateRuntime, fixture.paymasterProxyRuntime,
    fixture.paymasterImplementationRuntime];
}

function registryRuntime(row: GaslessDeployment, expected: Runtime): void {
  const address = getAddress(expected.address);
  const actual = row.code.filter((value) => value.address === address);
  assert.equal(actual.length, 1, `${row.chainId}: one code pin for ${address}`);
  assert.equal(actual[0]!.codeHash, expected.keccak256, `${row.chainId}: runtime ${address}`);
}

function registryStorage(row: GaslessDeployment, address: string, expected: Slot): void {
  const target = getAddress(address);
  const actual = row.reads.filter((value) => value.kind === "storage" && value.address === target &&
    value.data === expected.slot);
  assert.equal(actual.length, 1, `${row.chainId}: one storage pin for ${target}`);
  assert.equal(actual[0]!.expected, expected.word, `${row.chainId}: slot ${expected.slot}`);
}

test("retained deployment fixtures cover exactly the seven admitted chains", async () => {
  const rows = await fixtures();
  assert.deepEqual(rows.map((row) => row.chainId), CHAIN_IDS);
  assert.equal(new Set(rows.map((row) => row.network)).size, CHAIN_IDS.length);
  for (const row of rows) {
    assert.equal(row.schema, "apn.gasless.deployment-evidence.v1");
    assert.equal(row.evidenceBoundary, "retained public read-only RPC");
    assert.equal(runtimes(row).length, 7);
  }
});

test("compact raw runtime samples reproduce independently frozen byte pins", async () => {
  const samples = (await fixtures()).flatMap((fixture) => runtimes(fixture).filter(
    (runtime): runtime is Runtime & { raw: Hex } => runtime.raw !== undefined,
  ));
  assert.equal(samples.length, 25);
  for (const sample of samples) {
    assert.equal((sample.raw.length - 2) / 2, sample.bytes, sample.provenance.responseFile);
    assert.equal(keccak256(sample.raw), sample.keccak256, sample.provenance.responseFile);
    assert.equal(sample.provenance.method, "eth_getCode");
    assert.match(sample.provenance.responseFileSha256 ?? "", /^[0-9a-f]{64}$/u);
  }
});

test("production registry equals retained token, library, EntryPoint, delegate and paymaster evidence", async () => {
  const expected = await fixtures();
  assert.equal(GASLESS_DEPLOYMENTS.length, expected.length);
  for (const fixture of expected) {
    const rows = GASLESS_DEPLOYMENTS.filter((candidate) => candidate.chainId === fixture.chainId);
    assert.equal(rows.length, 1, `${fixture.chainId}: one registry row`);
    const row = rows[0]!;
    assert.equal(row.network, fixture.network);
    assert.equal(row.token, getAddress(fixture.token.address));
    assert.equal(row.paymaster, getAddress(fixture.paymasterProxyRuntime.address));
    assert.equal(row.entryPoint, getAddress(fixture.entryPointRuntime.address));
    assert.equal(row.delegate, getAddress(fixture.delegateRuntime.address));
    assert.deepEqual(row.tokenDomain, { name: fixture.token.domain.name, version: fixture.token.domain.version,
      chainId: fixture.chainId, verifyingContract: getAddress(fixture.token.address),
      domainSeparator: fixture.token.domain.separator });
    assert.equal(fixture.token.domain.decimals, 6);
    assert.equal(hashDomain({ domain: { name: fixture.token.domain.name, version: fixture.token.domain.version,
      chainId: BigInt(fixture.chainId), verifyingContract: getAddress(fixture.token.address) }, types: DOMAIN_TYPES }),
    fixture.token.domain.separator, `${fixture.chainId}: local EIP-712 domain`);
    if (fixture.chainId === 130) assert.equal(fixture.token.domain.name, "USDC");
    else assert.equal(fixture.token.domain.name, "USD Coin");

    for (const runtime of runtimes(fixture)) registryRuntime(row, runtime);
    registryStorage(row, fixture.token.address, fixture.token.implementationSlot);
    registryStorage(row, fixture.paymasterProxyRuntime.address, fixture.paymasterImplementationSlot);

    const nameRead = row.reads.filter((value) => value.kind === "call" && value.address === row.token &&
      value.data === "0x06fdde03");
    const domainRead = row.reads.filter((value) => value.kind === "call" && value.address === row.token &&
      value.data === "0x3644e515");
    assert.equal(nameRead.length, 1);
    assert.equal(nameRead[0]!.expected,
      encodeAbiParameters(parseAbiParameters("string"), [fixture.token.domain.name]));
    assert.equal(domainRead.length, 1);
    assert.equal(domainRead[0]!.expected, fixture.token.domain.separator);
  }
});
