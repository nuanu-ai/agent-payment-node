import assert from "node:assert/strict";
import test from "node:test";
import { CIRCLE_V2_STATES, CIRCLE_V2_TERMINAL_STATES } from "../../src/circle-v2-evm/funding-operation.js";
import { CIRCLE_V1_STATES, CIRCLE_V1_TERMINAL_STATES } from "../../src/circle-v2-evm/operation-model.js";
import { FACILITATOR_STATES, FACILITATOR_TERMINAL } from "../../src/facilitator-gasless/operation-model.js";
import { GASLESS_TERMINAL } from "../../src/gasless/operation-model.js";
import { stateSchema as gaslessStates } from "../../src/gasless/schema.js";
import { USDT_EXECUTION_OPEN_STATES, USDT_EXECUTION_STATES } from "../../src/gasless-usdt/execution-journal.js";
import { CIRCLE_APPROVAL_PHASES, CIRCLE_APPROVAL_RESOLVED_PHASES } from "../../src/lifi/circle-v2-approval-executor.js";
import { GASZIP_STATES, GASZIP_TERMINAL_STATES } from "../../src/lifi/gaszip-outcome.js";
import { ONECLICK_SOURCE_EDGES } from "../../src/lifi/near-oneclick-source-journal.js";
import { NON_EVM_SOURCE_PHASES } from "../../src/lifi/non-evm-source-journal.js";
import { BRIDGE_TERMINAL } from "../../src/lifi/operation-model.js";
import { stateSchema as bridgeStates } from "../../src/lifi/schema.js";
import { MM_STATES } from "../../src/metamask-gasless/journal/schema.js";
import { MM_TERMINAL } from "../../src/metamask-gasless/operation-model.js";
import { METAMASK_NATIVE_RESOLVED_STATES, METAMASK_NATIVE_STATES } from "../../src/metamask-native-journal.js";
import { DIRECT_OPERATION_STATES, LOCAL_DIRECT_TERMINAL_STATES, PROVIDER_DIRECT_TERMINAL_STATES } from "../../src/model.js";
import { operationRegistry } from "../../src/operation-index/registry.js";
import type { OperationFamily } from "../../src/operation-index/types.js";
import { PROVIDER_X402_STATES, PROVIDER_X402_TERMINAL_STATES } from "../../src/provider-x402-model.js";
import { RAIL_STATES, RAIL_TERMINAL_STATES } from "../../src/rail-operation-model.js";
import { ARBITRUM_EFFECT_PHASES } from "../../src/relay/arbitrum-source-effect-journal.js";
import { RELAY_EFFECT_OBSERVED_PHASES, RELAY_EFFECT_PHASES } from "../../src/relay/effect-journal.js";
import { relayEffectsOutcome, relayNativeSourceOutcome } from "../../src/relay/lifecycle.js";
import { RELAY_NATIVE_SOURCE_EDGES, RELAY_NATIVE_SOURCE_PHASES } from "../../src/relay/native-source-journal.js";
import { SA_TERMINAL } from "../../src/smart-account-gasless/operation-model.js";
import { SA_STATES } from "../../src/smart-account-gasless/transitions.js";
import { STARGATE_NATIVE_PHASES, STARGATE_NATIVE_TERMINAL_PHASES } from "../../src/stargate-v2/native-record.js";
import { STARGATE_TOKEN_TRANSITIONS } from "../../src/stargate-v2/token-journal.js";
import { SWAP_OPERATION_STATES, SWAP_TERMINAL_STATES } from "../../src/swap/model.js";
import { UNISWAP_TOKEN_PHASES, UNISWAP_TOKEN_TERMINAL_PHASES } from "../../src/swap/uniswap-v3/token-operation.js";
import { MERCHANT_PHASES, MERCHANT_TERMINAL_PHASES } from "../../src/x402-merchant/model.js";
import { PERMIT2_PRODUCTION_STATES, PERMIT2_PRODUCTION_TERMINAL_STATES } from "../../src/x402-permit2/production-repository.js";
import { STATE_SHAPE } from "../../src/x402-state-shape.js";

/**
 * Every adapter's terminal decision against its family's own notion of terminal, enumerated from the family's code: its
 * state list and its outcome list (or the states its transition table never leaves). A state the adapter misses would
 * hold an account and a profile forever; an extra one would release a claim an operation still needs. Each case gives a
 * record holding only the fields the adapter reads, with every deadline in the future and no `terminal` flag, so the
 * family's time rules stay off and the adapter can only answer from the state.
 */
interface Case {
  readonly label: string;
  readonly states: readonly string[];
  readonly terminal: (state: string) => boolean;
  readonly record: (state: string) => unknown;
}
const FUTURE = new Date(Date.now() + 3_600_000).toISOString(), FUTURE_SECONDS = Math.floor(Date.parse(FUTURE) / 1000);
const listed = (list: readonly string[]) => (state: string) => list.includes(state);
const noExit = (edges: Readonly<Record<string, readonly string[]>>) => (state: string) => edges[state]?.length === 0;
const byState = (label: string, states: readonly string[], terminal: readonly string[], extra: Record<string, unknown> = {}): Case =>
  ({ label, states, terminal: listed(terminal), record: state => ({ state, ...extra }) });
const byPhase = (label: string, states: readonly string[], terminal: (phase: string) => boolean, extra: Record<string, unknown> = {}): Case =>
  ({ label, states, terminal, record: phase => ({ phase, ...extra }) });

const CASES: Readonly<Record<Exclude<OperationFamily, "relay_unsigned">, readonly Case[]>> = {
  direct_transfer: [byState("local", DIRECT_OPERATION_STATES, LOCAL_DIRECT_TERMINAL_STATES),
    byState("provider", DIRECT_OPERATION_STATES, PROVIDER_DIRECT_TERMINAL_STATES, { providerDirect: {} })],
  x402_fetch: [{ label: "local", states: Object.keys(STATE_SHAPE), terminal: state => STATE_SHAPE[state as keyof typeof STATE_SHAPE].terminal,
    record: state => ({ strategy: "local", record: { state } }) },
  { label: "provider", states: PROVIDER_X402_STATES, terminal: listed(PROVIDER_X402_TERMINAL_STATES), record: state => ({ strategy: "provider_atomic", record: { state } }) }],
  rail_transfer: [byState("rail", RAIL_STATES, RAIL_TERMINAL_STATES)],
  bridge_route: [byState("bridge", bridgeStates.options, BRIDGE_TERMINAL)],
  gasless_transfer: [byState("gasless", gaslessStates.options, GASLESS_TERMINAL)],
  metamask_gasless_transfer: [byState("metamask gasless", MM_STATES, MM_TERMINAL)],
  smart_account_gasless_transfer: [byState("smart account", SA_STATES, SA_TERMINAL)],
  facilitator_gasless_transfer: [byState("facilitator", FACILITATOR_STATES, FACILITATOR_TERMINAL)],
  circle_route: [byState("v1", CIRCLE_V1_STATES, CIRCLE_V1_TERMINAL_STATES, { schemaVersion: "apn.circle-v2-evm-operation.v1" }),
    byState("v2", CIRCLE_V2_STATES, CIRCLE_V2_TERMINAL_STATES, { schemaVersion: "apn.circle-v2-evm-operation.v2" })],
  merchant_x402: [byState("merchant", MERCHANT_PHASES, MERCHANT_TERMINAL_PHASES, { expiresAt: FUTURE })],
  permit2_production: [byState("permit2", PERMIT2_PRODUCTION_STATES, PERMIT2_PRODUCTION_TERMINAL_STATES)],
  sei_gaszip: [byState("sei", GASZIP_STATES, GASZIP_TERMINAL_STATES)],
  mega_gaszip: [byState("mega", GASZIP_STATES, GASZIP_TERMINAL_STATES)],
  swap: [byState("swap", SWAP_OPERATION_STATES, SWAP_TERMINAL_STATES, { submissionMarker: null, quote: { expiresAt: FUTURE } })],
  uniswap_token: [byPhase("uniswap token", UNISWAP_TOKEN_PHASES, listed(UNISWAP_TOKEN_TERMINAL_PHASES), { route: { deadline: FUTURE_SECONDS } })],
  stargate_native: [byPhase("stargate native", STARGATE_NATIVE_PHASES, listed(STARGATE_NATIVE_TERMINAL_PHASES), { expiresAt: FUTURE })],
  stargate_token: [byPhase("stargate token", Object.keys(STARGATE_TOKEN_TRANSITIONS), noExit(STARGATE_TOKEN_TRANSITIONS), { expiresAt: FUTURE })],
  gasless_usdt: [{ label: "usdt", states: USDT_EXECUTION_STATES, terminal: state => !(USDT_EXECUTION_OPEN_STATES as readonly string[]).includes(state),
    record: state => ({ state }) }],
  oneclick_source: [byPhase("1click", Object.keys(ONECLICK_SOURCE_EDGES), noExit(ONECLICK_SOURCE_EDGES), { effectiveDeadline: FUTURE })],
  // No phase is an outcome: its signing window ends the claim, or earlier a finalized burn receipt its status records
  // beside the journal (a record without a burn hash, like these, never reads one).
  circle_source: [byPhase("cctp source", NON_EVM_SOURCE_PHASES, () => false, { createdAt: new Date().toISOString() })],
  circle_approval: [byPhase("circle approval", CIRCLE_APPROVAL_PHASES, listed(CIRCLE_APPROVAL_RESOLVED_PHASES), { preparation: { expiresAt: FUTURE } })],
  metamask_native: [{ label: "metamask native", states: METAMASK_NATIVE_STATES, terminal: listed(METAMASK_NATIVE_RESOLVED_STATES),
    record: state => ({ state, effectAttempts: state === "prepared" ? 0 : 1, context: { consentExpiresAt: FUTURE } }) }],
};

test("every adapter is terminal exactly in its family's own terminal states", async () => {
  const registry = operationRegistry();
  // A family that joins the registry brings its case here; Relay's terminal is its lanes' outcomes (checked below).
  assert.deepEqual([...registry.keys()].filter(family => family !== "relay_unsigned").sort(), Object.keys(CASES).sort());
  for (const [family, cases] of Object.entries(CASES)) {
    const adapter = registry.get(family as OperationFamily)!;
    for (const { label, states, terminal, record } of cases) {
      assert.ok(states.length > 1 && states.some(terminal) !== (family === "circle_source"), `${family} ${label}: the family names its states and outcomes`);
      for (const state of states) {
        assert.equal(await adapter.terminal(record(state) as never, "/unused"), terminal(state), `${family} ${label}: ${state}`);
      }
    }
  }
});

test("a frozen legacy bridge journal holds its account but not its profile; a current one holds both", () => {
  const adapter = operationRegistry().get("bridge_route")!;
  assert.equal(adapter.holdsProfile?.({ schemaVersion: "apn.bridge-operation.legacy-view.v1", state: "source_pending" }), false);
  assert.equal(adapter.holdsProfile?.({ schemaVersion: "apn.bridge-operation.v1", state: "source_pending" }), true);
});

test("Relay ends a spend attempt exactly at each lane's own outcomes", () => {
  // Native lane: every phase its transition table never leaves is an outcome (failed_before_effect: nothing was signed).
  for (const phase of RELAY_NATIVE_SOURCE_PHASES) {
    assert.equal(relayNativeSourceOutcome(phase) !== null, RELAY_NATIVE_SOURCE_EDGES[phase].length === 0, phase);
  }
  assert.equal(relayNativeSourceOutcome("failed_before_effect"), "failed_before_effect");
  // Two-effect lanes: an observed deposit ends it, and so does either effect's observed failure or proven non-landing; a
  // confirmed approval is followed by its deposit.
  for (const phases of [RELAY_EFFECT_PHASES, ARBITRUM_EFFECT_PHASES] as readonly (readonly string[])[]) {
    for (const phase of phases) {
      const observed = (RELAY_EFFECT_OBSERVED_PHASES as readonly string[]).includes(phase);
      assert.equal(relayEffectsOutcome([{ phase: "confirmed" }, { phase }]) !== null, observed, `deposit ${phase}`);
      assert.equal(relayEffectsOutcome([{ phase }, { phase: "pending" }]) !== null, observed && phase !== "confirmed", `approval ${phase}`);
    }
  }
});
