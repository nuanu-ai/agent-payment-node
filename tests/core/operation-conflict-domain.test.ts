import assert from "node:assert/strict";
import test from "node:test";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { bridgeConflictDomain, SOLANA_BRIDGE_CHAIN_ID, storedOperationDomains } from "../../src/operation-conflict-domain.js";
import { OperationService, type StoredMoneyOperation } from "../../src/operation-service.js";
import { TRON_GENESIS } from "../../src/tron/constants.js";

const PROFILE = "1".repeat(64);
const A = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const B = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const TRON = "TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS";
const SOLANA = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

type Stored = Readonly<Record<string, unknown>> & { readonly operationId: string; readonly state: string; readonly terminal: boolean };
interface Stores {
  readonly direct?: readonly Stored[]; readonly x402?: readonly Stored[]; readonly providerX402?: readonly Stored[];
  readonly rails?: readonly Stored[]; readonly bridges?: readonly Stored[]; readonly gasless?: readonly Stored[];
  readonly metaMask?: readonly Stored[]; readonly smartAccount?: readonly Stored[]; readonly facilitator?: readonly Stored[];
}

function service(stores: Stores): OperationService {
  const owned = (records: readonly Stored[] = []) => async (profileHash: string) => profileHash === PROFILE ? records : [];
  const repository = (records?: readonly Stored[]) => ({ listOperations: owned(records) }) as never;
  const state = { listOperations: owned(stores.direct), listX402Operations: owned(stores.x402) } as never;
  return new OperationService(state, repository(stores.providerX402), repository(stores.rails), repository(stores.bridges),
    repository(stores.gasless), repository(stores.metaMask), repository(stores.smartAccount), repository(stores.facilitator));
}
const open = (operationId: string, fields: Readonly<Record<string, unknown>>): Stored =>
  ({ operationId, state: "unknown_finality", terminal: false, ...fields });
const gaslessOn = (chainId: number, address: string, operationId = "gasless-1") =>
  open(operationId, { intent: { request: { chainId }, owner: { address } } });
const blockedOn = (operationId: string, network: string, account: string) => ({
  code: "APN_OPERATION_BLOCKED", message: "Another money operation for this network and account is not terminal.",
  details: { blockingOperationId: operationId, blockingState: "unknown_finality", blockingNetwork: network, blockingAccount: account },
});

test("an unresolved operation blocks only its own chain and sending account", async () => {
  const operations = service({ gasless: [gaslessOn(137, A)] });
  await operations.assertEvmAccountAvailable(PROFILE, 8453, A);
  await operations.assertEvmAccountAvailable(PROFILE, 137, B);
  await operations.assertRailAccountAvailable(PROFILE, "tron", TRON);
  await operations.assertEvmAccountAvailable("2".repeat(64), 137, A);
  await assert.rejects(operations.assertEvmAccountAvailable(PROFILE, 137, A.toLowerCase()), blockedOn("gasless-1", "evm:137", A.toLowerCase()));
  await assert.rejects(operations.assertEvmAccountAvailable(PROFILE, "137", A), blockedOn("gasless-1", "evm:137", A.toLowerCase()));
});

test("wallet lifecycle keeps the whole-profile guard", async () => {
  await assert.rejects(service({ gasless: [gaslessOn(137, A)] }).assertProfileAvailable(PROFILE), {
    code: "APN_OPERATION_BLOCKED", message: "Another money operation for this profile is not terminal.",
    details: { blockingOperationId: "gasless-1", blockingState: "unknown_finality" },
  });
});

test("a MetaMask gasless operation on Base blocks the same address on Base but not on Arbitrum", async () => {
  const operations = service({ metaMask: [open("mm-1", { intent: { request: { chainId: 8453 }, binding: { address: B } } })] });
  await assert.rejects(operations.assertEvmAccountAvailable(PROFILE, 8453, B), blockedOn("mm-1", "evm:8453", B));
  await operations.assertEvmAccountAvailable(PROFILE, 42161, B);
});

test("an Avalanche facilitator operation blocks the same Local address on Avalanche only", async () => {
  const operations = service({ facilitator: [open("avax-1", { intent: { request: { chainId: 43114 }, owner: { address: A } } })] });
  await assert.rejects(operations.assertEvmAccountAvailable(PROFILE, 43114, A), blockedOn("avax-1", "evm:43114", A.toLowerCase()));
  await operations.assertEvmAccountAvailable(PROFILE, 8453, A);
});

test("rail operations are scoped by rail genesis and sender", async () => {
  const operations = service({ rails: [open("tron-1", { account: { rail: "tron", address: TRON } })] });
  await assert.rejects(operations.assertRailAccountAvailable(PROFILE, "tron", TRON), blockedOn("tron-1", `tron:${TRON_GENESIS}`, TRON));
  await operations.assertRailAccountAvailable(PROFILE, "solana", SOLANA);
  await operations.assertEvmAccountAvailable(PROFILE, 8453, A);
});

const bridgeOn = (chainId: number | string, address: string, operationId = "bridge-1") =>
  open(operationId, { intent: { sourceDeployment: { chainId }, owner: { address } } });

test("a Solana-side bridge takes the Solana rail lock, and an EVM bridge is unchanged", async () => {
  const solana = service({ bridges: [bridgeOn(SOLANA_BRIDGE_CHAIN_ID, SOLANA)] });
  // One money operation per profile: the bridge and a direct Solana transfer share the one lock.
  await assert.rejects(solana.assertRailAccountAvailable(PROFILE, "solana", SOLANA), blockedOn("bridge-1", `solana:${SOLANA_GENESIS}`, SOLANA));
  await assert.rejects(solana.assertProfileAvailable(PROFILE), {
    code: "APN_OPERATION_BLOCKED", details: { blockingOperationId: "bridge-1", blockingState: "unknown_finality" },
  });
  // No accidental collision across chains or families.
  await solana.assertRailAccountAvailable(PROFILE, "solana", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFio");
  await solana.assertRailAccountAvailable(PROFILE, "tron", TRON);
  await solana.assertEvmAccountAvailable(PROFILE, 8453, A);
  await solana.assertEvmAccountAvailable(PROFILE, 1, A);

  const evm = service({ bridges: [bridgeOn(1, A)] });
  await assert.rejects(evm.assertEvmAccountAvailable(PROFILE, 1, A), blockedOn("bridge-1", "evm:1", A.toLowerCase()));
  await evm.assertEvmAccountAvailable(PROFILE, 8453, A);
  await evm.assertRailAccountAvailable(PROFILE, "solana", SOLANA);
});

test("a terminal Solana-side bridge releases the profile and the rail account", async () => {
  const released = service({ bridges: [{ ...bridgeOn(SOLANA_BRIDGE_CHAIN_ID, SOLANA), state: "completed", terminal: true }] });
  await released.assertRailAccountAvailable(PROFILE, "solana", SOLANA);
  await released.assertProfileAvailable(PROFILE);
});

test("the bridge domain refuses an account that is not its chain's own account form", () => {
  assert.deepEqual(bridgeConflictDomain(SOLANA_BRIDGE_CHAIN_ID, SOLANA), { family: "solana", network: SOLANA_GENESIS, account: SOLANA });
  assert.deepEqual(bridgeConflictDomain(8453, A), { family: "evm", network: "8453", account: A.toLowerCase() });
  assert.deepEqual(bridgeConflictDomain("42161", B), { family: "evm", network: "42161", account: B });
  // An EVM address on the Solana chain id, and a base58 address on an EVM chain id, are both refused.
  assert.throws(() => bridgeConflictDomain(SOLANA_BRIDGE_CHAIN_ID, A), /Invalid Solana bridge conflict domain/u);
  assert.throws(() => bridgeConflictDomain(SOLANA_BRIDGE_CHAIN_ID, "not-base58"), /Invalid Solana bridge conflict domain/u);
  assert.throws(() => bridgeConflictDomain(8453, SOLANA), /Invalid EVM conflict domain/u);
  assert.throws(() => bridgeConflictDomain(0, A), /Invalid EVM conflict domain/u);
});

test("terminal operations never block", async () => {
  await service({ gasless: [{ ...gaslessOn(137, A), state: "failed_before_effect", terminal: true }] }).assertEvmAccountAvailable(PROFILE, 137, A);
});

test("an unreadable stored or requested domain fails closed to the whole profile", async () => {
  const profileBlocked = (operationId: string) => ({ code: "APN_OPERATION_BLOCKED",
    message: "Another money operation for this profile is not terminal.", details: { blockingOperationId: operationId, blockingState: "unknown_finality" } });
  await assert.rejects(service({ gasless: [open("broken-1", {})] }).assertEvmAccountAvailable(PROFILE, 8453, B), profileBlocked("broken-1"));
  await assert.rejects(service({ gasless: [gaslessOn(137, A)] }).assertEvmAccountAvailable(PROFILE, 8453, "not-an-address"), profileBlocked("gasless-1"));
  await assert.rejects(service({ gasless: [gaslessOn(137, A)] }).assertEvmAccountAvailable(PROFILE, 0, A), profileBlocked("gasless-1"));
  await service({}).assertEvmAccountAvailable(PROFILE, 8453, "not-an-address");
});

test("every stored money family maps to its network and sending account", () => {
  const domains = (operation: unknown) => storedOperationDomains(operation as StoredMoneyOperation);
  const evm = (network: string, account: string) => [{ family: "evm", network, account: account.toLowerCase() }];
  assert.deepEqual(domains({ kind: "direct_transfer", record: open("d", { chainId: 42161, walletAddress: A }) }), evm("42161", A));
  assert.deepEqual(domains({ kind: "x402_fetch", strategy: "local", record: open("x", { chainId: "10", wallet: A.toLowerCase() }) }), evm("10", A));
  assert.deepEqual(domains({ kind: "x402_fetch", strategy: "provider_atomic", record: open("p", { provider: { payer: B } }) }), evm("8453", B));
  assert.deepEqual(domains({ kind: "rail_transfer", record: open("r", { account: { rail: "solana", address: SOLANA } }) }),
    [{ family: "solana", network: SOLANA_GENESIS, account: SOLANA }]);
  assert.deepEqual(domains({ kind: "bridge_route", record: bridgeOn(1, A, "b") }), evm("1", A));
  assert.deepEqual(domains({ kind: "bridge_route", record: bridgeOn(8453, B, "b") }), evm("8453", B));
  assert.deepEqual(domains({ kind: "bridge_route", record: bridgeOn(SOLANA_BRIDGE_CHAIN_ID, SOLANA, "b") }),
    [{ family: "solana", network: SOLANA_GENESIS, account: SOLANA }]);
  assert.equal(domains({ kind: "bridge_route", record: bridgeOn(SOLANA_BRIDGE_CHAIN_ID, A, "b") }), null);
  assert.deepEqual(domains({ kind: "gasless_transfer", record: gaslessOn(137, A) }), evm("137", A));
  assert.deepEqual(domains({ kind: "metamask_gasless_transfer", record: open("m", { intent: { request: { chainId: 8453 }, binding: { address: B } } }) }), evm("8453", B));
  assert.deepEqual(domains({ kind: "smart_account_gasless_transfer", record: open("s", { intent: { request: { chainId: 8453 }, binding: { ownerAddress: A } } }) }), evm("8453", A));
  assert.equal(domains({ kind: "gasless_transfer", record: open("g", { intent: { request: {}, owner: { address: A } } }) }), null);
});
