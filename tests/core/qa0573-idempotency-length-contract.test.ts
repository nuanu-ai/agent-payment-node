/**
 * QA 0.5.73 IDEMPOTENCY-LENGTH-CONTRACT-072-002: `apn help` and the MCP description promised 8..128 for x402 merchant while
 * its pattern and runtime took 8..200, and the shared parser took up to 200 for Stargate, whose prepare then refused 129.
 * Each command now declares exactly one maximum. Help, the MCP schema, the CLI/MCP parser and the family's own prepare read
 * it, so a key the parser admits is never refused later for its length, and every refusal happens before any state or RPC.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS, parseCatalogInput } from "../../src/command-catalog.js";
import { renderHelp } from "../../src/command-help.js";
import { ApnError } from "../../src/errors.js";
import { declaredIdempotencyKeyMaximum, idempotencyKeyPattern } from "../../src/idempotency-key-contract.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { canonicalIdempotencyKey } from "../../src/transfer-policy.js";
import { swapIdempotencyHash } from "../../src/swap/service.js";
import { prepareStargateV2NativeEth } from "../../src/stargate-v2/native-execution.js";
import { prepareStargateV2Token } from "../../src/stargate-v2/token-execution.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { CircleFundingEvmService } from "../../src/circle-v2-evm/funding-runtime.js";
import { CircleV2SourceService } from "../../src/lifi/circle-v2-source-service.js";
import { OneClickSourceService } from "../../src/lifi/near-oneclick-source-service.js";
import { GaslessUsdtCommandPrepare } from "../../src/gasless-usdt/command-prepare.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const LENGTHS = [7, 8, 128, 129, 200, 201] as const;
const key = (length: number): string => `k${"a".repeat(length - 1)}`;
const admitted = (length: number, maximum: 128 | 200): boolean => length >= 8 && length <= maximum;
/** Eight characters each, so only the alphabet refuses them: a leading separator, a slash, a space. */
const OFF_ALPHABET = [".kaaaaaa", "k/aaaaaa", "k aaaaaa"] as const;
const EXPECTED: Readonly<Record<string, 128 | 200>> = {
  "x402 permit2 approve": 200, "x402 solana pay": 200, "x402 permit2 allowance set": 200, "x402 permit2 allowance revoke": 200,
  "x402 merchant prepare": 200, "relay prepare": 128, "stargate native prepare": 128, "stargate token prepare": 128,
  "pay transfer prepare-asset": 200, "wallet connect": 200, "wallet metamask native-transfer": 200, "x402 fetch prepare": 200,
  "pay transfer prepare": 200, "operation recover-transaction-settlement": 200, "pay transfer prepare-solana": 200,
  "pay transfer prepare-tron": 200, "bridge prepare": 200, "circle source submit": 128, "sei funding prepare": 200,
  "circle evm prepare": 128, "mega funding prepare": 200, "oneclick source submit": 128, "gasless usdt prepare": 128,
  "gasless transfer prepare": 200, "swap ethereum uniswap prepare": 200, "swap ethereum uniswap-token prepare": 200,
  "swap tron sunswap prepare": 200, "swap solana jupiter prepare": 200, "swap solana orca prepare": 200,
};

test("every idempotency key option declares one maximum that help, the MCP schema and the parser all apply", () => {
  const keyed = COMMANDS.flatMap((command) => command.options.filter((option) => option.type === "idempotency_key").map((option) => ({ command, option })));
  assert.deepEqual(Object.fromEntries(keyed.map(({ command, option }) => [command.path.join(" "), declaredIdempotencyKeyMaximum(option.constraints)])), EXPECTED);
  const tools = projectMcpTools();
  for (const { command, option } of keyed) {
    const maximum = EXPECTED[command.path.join(" ")]!, label = `8_to_${maximum}_safe_ascii_characters`;
    assert.equal(option.constraints.filter((constraint) => /^8_to_\d+_safe_ascii_characters$/u.test(constraint)).length, 1);
    assert.match(renderHelp(command.path), new RegExp(`--idempotency-key <idempotency_key>  (?:required|optional); .*${label}`, "u"));
    const tool = tools.find((candidate) => candidate.command === command);
    if (tool !== undefined) {
      assert.deepEqual(tool.inputSchema.properties.idempotency_key, { type: "string", description: `idempotency_key: ${option.constraints.join(", ")}`,
        pattern: idempotencyKeyPattern(maximum) }, tool.name);
    }
    for (const length of LENGTHS) {
      let refused = false;
      try { parseCatalogInput(command, { "--idempotency-key": key(length) }); } catch (error) {
        refused = error instanceof ApnError && error.message === "--idempotency-key does not satisfy its declared idempotency_key contract.";
      }
      assert.equal(refused, !admitted(length, maximum), `${command.path.join(" ")} length ${length}`);
    }
    for (const value of OFF_ALPHABET) assert.throws(() => parseCatalogInput(command, { "--idempotency-key": value }),
      { message: "--idempotency-key does not satisfy its declared idempotency_key contract." }, `${command.path.join(" ")} ${value}`);
  }
  assert.throws(() => declaredIdempotencyKeyMaximum(["global_payment_key"]), (error: unknown) => error instanceof ApnError && error.code === "APN_INTERNAL");
  for (const constraints of [["8_to_128_safe_ascii_characters", "8_to_200_safe_ascii_characters"], ["global_payment_key", "8_to_64_safe_ascii_characters"],
    ["8_to_200_safe_ascii_characters", "8_to_64_safe_ascii_characters"]]) {
    assert.throws(() => declaredIdempotencyKeyMaximum(constraints), (error: unknown) => error instanceof ApnError && error.code === "APN_INTERNAL");
  }
});

class Sentinel extends Error {}
/** State that ends the probe at the first read after the key check: nothing is written, read or sent. */
const sentinelState = new Proxy({}, { get: () => () => { throw new Sentinel("sentinel"); } }) as never;
const OWNER = "0x1111111111111111111111111111111111111111", RECIPIENT = "0x2222222222222222222222222222222222222222";
const stargatePorts = { signer: { kind: "imported_evm_signer", address: OWNER, signTransaction: async () => { throw new Sentinel("sign"); } } } as never;
const stargateJournal = { load: async () => { throw new Sentinel("journal"); } } as never;
const wrapping = { load: async () => { throw new Sentinel("wrapping"); }, create: async () => { throw new Sentinel("wrapping"); } } as never;

/** "admitted" when the probe passes the key check (it then stops at the sentinel or the next prerequisite), else "refused". */
async function probe(run: () => unknown, refusal: (error: ApnError) => boolean): Promise<"admitted" | "refused"> {
  try { await run(); return "admitted"; } catch (error) {
    if (error instanceof Sentinel) return "admitted";
    assert.ok(error instanceof ApnError, String(error));
    return refusal(error) ? "refused" : "admitted";
  }
}
const reason = (expected: string) => (error: ApnError) => error.details?.reason === expected;
const message = (expected: string) => (error: ApnError) => error.message === expected;

test("each family's prepare refuses a key outside its declared maximum before any state, signer or RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const relay = new RelayUnsignedPrepareService(sentinelState, { now: () => new Date() } as never, {} as never, {});
  const relayInput = { profile: "owner", recipient: RECIPIENT, amountAtomic: "500000", minOutputAtomic: "400000", maxApprovalNetworkFeeWei: "1",
    maxDepositNetworkFeeWei: "1" };
  const families: readonly { name: string; maximum: 128 | 200; run: (key: string) => unknown; refusal: (error: ApnError) => boolean }[] = [
    { name: "shared canonical key", maximum: 200, run: canonicalIdempotencyKey, refusal: message("Idempotency key must be 8-200 safe ASCII characters.") },
    { name: "swap", maximum: 200, run: swapIdempotencyHash, refusal: message("Swap idempotency key is invalid.") },
    { name: "stargate native", maximum: 128, refusal: reason("idempotency_key"), run: (k) => prepareStargateV2NativeEth({ profile: "owner", owner: OWNER,
      recipient: OWNER, amountAtomic: "1000", maxNativeDebitAtomic: "2000", idempotencyKey: k } as never, stargatePorts, stargateJournal) },
    { name: "stargate token", maximum: 128, refusal: reason("idempotency_key"), run: (k) => prepareStargateV2Token({ profile: "owner", owner: OWNER,
      recipient: OWNER, amountAtomic: "1000", nativeDropAtomic: "0", minOutputAtomic: "900", maxNativeDebitAtomic: "2000", idempotencyKey: k } as never,
    stargatePorts, stargateJournal) },
    { name: "relay", maximum: 128, refusal: message("Relay prepare inputs are invalid."), run: (k) => relay.prepare({ ...relayInput, idempotencyKey: k } as never) },
    { name: "relay native", maximum: 128, refusal: message("Relay native prepare inputs are invalid."), run: (k) => relay.prepareNative({ ...relayInput,
      sourceChain: "eip155:8453", destinationChain: "eip155:137", idempotencyKey: k } as never) },
    { name: "relay arbitrum", maximum: 128, refusal: message("Relay Arbitrum prepare inputs are invalid."), run: (k) => relay.prepareArbitrum({ ...relayInput,
      owner: OWNER, maxProviderFeeAtomic: "1", quoteFile: "/nonexistent/qa0573-quote.json", idempotencyKey: k } as never) },
    { name: "circle evm", maximum: 128, refusal: reason("idempotency_key"), run: (k) => new CircleFundingEvmService(state, wrapping, {}).prepare({
      profile: "owner", destinationProfile: "destination", destinationChain: 1329, idempotencyKey: k } as never) },
    { name: "circle source", maximum: 128, refusal: message("Bridge validation failed: circle_v2_source_service_idempotency_key."),
      run: (k) => new CircleV2SourceService(sentinelState, wrapping, {}).submit({ profile: "owner", expectedPayer: OWNER, recipientOwner: OWNER,
        recipientSetup: "existing_ata", amountAtomic: "430000", maxSourceFeeAtomic: "10000", maxAllowanceAtomic: "430000", maxGasLimitAtomic: "300000",
        maxFeePerGasWei: "2", maxPriorityFeePerGasWei: "1", maxNativeDebitWei: "1", idempotencyKey: k }) },
    { name: "oneclick source", maximum: 128, refusal: message("Bridge validation failed: oneclick_source_idempotency_key."),
      run: (k) => new OneClickSourceService(sentinelState, wrapping, {}).submit({ lane: "base-usdc-to-tron-usdt", profile: "owner", expectedPayer: OWNER,
        recipient: "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF", amountAtomic: "3000000", minOutputAtomic: "1000000", maxQuotedLossAtomic: "2000000",
        maxGasLimitAtomic: "100000", maxFeePerGasWei: "2", maxPriorityFeePerGasWei: "1", maxNativeDebitWei: "1", idempotencyKey: k }) },
    { name: "gasless usdt", maximum: 128, refusal: reason("bound_key"), run: (k) => new GaslessUsdtCommandPrepare(sentinelState, { now: () => new Date() } as never,
      sentinelState).prepare({ profile: "owner", idempotencyKey: k } as never) },
  ];
  for (const family of families) {
    const outcomes = [];
    for (const length of LENGTHS) outcomes.push(await probe(() => family.run(key(length)), family.refusal));
    for (const value of OFF_ALPHABET) outcomes.push(await probe(() => family.run(value), family.refusal));
    assert.deepEqual(outcomes, [...LENGTHS.map((length) => admitted(length, family.maximum) ? "admitted" : "refused"), ...OFF_ALPHABET.map(() => "refused")],
      family.name);
  }
});
