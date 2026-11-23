import { UNISWAP_TOKEN_TERMINAL_PHASES, UniswapTokenJournal, type UniswapTokenOperation } from "../../swap/uniswap-v3/token-operation.js";
import { tokenLaneCommands, tokenLaneOf } from "../../swap/uniswap-v3/token-lane.js";
import { BNB_UNISWAP_TOKEN_ROUTE_SCHEMA } from "../../swap/uniswap-bnb/token-route.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, type OperationFamilyAdapter, type OperationStore } from "../adapter.js";
import { evmClaim, namedProfileHash, pastUnstartedDeadline, salvageNamedRecord } from "./family-claims.js";
import { OPERATION_STATUS } from "./family-commands.js";

const STORE: OperationStore = { directory: "uniswap-token-operations", perProfile: false };
/** The Ethereum token lane's chain; a BNB Smart Chain route (its own schema) claims chain 56. */
export const UNISWAP_TOKEN_CHAIN_ID = 1;

/**
 * Uniswap token swaps: approval, swap and cleanup all sign with the account on the route's own chain (Ethereum, or BNB
 * Smart Chain for a BNB route). A `prepared` swap is retired unsigned once its route deadline passed (approve and
 * execute both retire it first).
 */
export const uniswapTokenAdapter: OperationFamilyAdapter<UniswapTokenOperation> = {
  family: "uniswap_token",
  stores: [STORE],
  async load(root, recordPath) { return await new UniswapTokenJournal(root).read(requiredRecordPath(recordPath, STORE).operationId); },
  identity: record => ({ profileHash: namedProfileHash(record.profile), operationId: record.operationId, idempotencyHash: null, requestHash: null }),
  claims: record => readableClaims(() => [evmClaim(tokenLaneOf(record.route).chainId, record.account)]),
  terminal: record => UNISWAP_TOKEN_TERMINAL_PHASES.includes(record.phase) ||
    record.phase === "prepared" && pastUnstartedDeadline(record.route.deadline * 1000),
  state: record => record.phase,
  salvage: raw => salvageNamedRecord(raw, value => [salvageEvm(field(value, "route", "schemaVersion") === BNB_UNISWAP_TOKEN_ROUTE_SCHEMA ? 56 :
    UNISWAP_TOKEN_CHAIN_ID, field(value, "account"))], "profile"),
  view: async record => record,
  // Its status reads the journal and observes an attempted approval, swap or cleanup; execute and cleanup are its own steps.
  status: async (context, record) => tokenLaneOf(record.route).chainId === 56
    ? await (await import("../../swap/uniswap-bnb/token-command-service.js")).executeUniswapBnbTokenCommand(
      { command: "swap.uniswap-bnb-token.status", operationId: record.operationId }, context)
    : await (await import("../../swap/uniswap-command-service.js")).executeUniswapCommand(
      { command: "swap.uniswap-token.status", operationId: record.operationId }, context),
  // The last-resort owner exit (R4): past the route deadline, with TTY consent; the usage hold stays charged until execute
  // proves no swap of it can land (no swap marker, or custody holding no signed bytes for its hashless one).
  abandon: async (context, record) => await (await import("../../swap/uniswap-v3/token-abandon.js")).abandonUniswapToken(context.state.root,
    record.operationId, async intent => await context.requireOperationAbandonApproval().approve(intent), () => context.clock.now()),
  commands: { status: OPERATION_STATUS, resume: "apn swap ethereum uniswap-token execute --operation <operation-id>",
    exit: "apn swap ethereum uniswap-token cleanup --operation <operation-id>" },
  // A BNB route's own family commands; an Ethereum record keeps `commands` above.
  commandsFor: record => ({ status: OPERATION_STATUS, ...tokenLaneCommands(tokenLaneOf(record.route)) }),
  runtimeCommand: async record => tokenLaneOf(record.route).chainId === 56 ? "swap.uniswap-bnb-token.status" : "swap.uniswap-token.status",
};
