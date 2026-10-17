import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ApnError } from "./errors.js";
import { abandonMetaMaskNativeTransfer } from "./metamask-native-transfer-owner.js";
import type { OperationStore } from "./operation-index/adapter.js";
import type { OperationRegistry } from "./operation-index/registry.js";
import type { OperationFamily } from "./operation-index/types.js";
import type { RuntimeContext } from "./runtime.js";
import { abandonSwapOperation } from "./swap/abandon.js";

/**
 * Families whose operation-index adapters have not joined the registry yet (phase 4b WP2 adds them). The generic
 * commands find their operations by name only, so they can name the family's own commands, and `operation abandon`
 * keeps reaching the two owner exits these families already have. Each row stops applying the moment its family is
 * registered: the index then finds the operation and its adapter answers. Delete a row once its adapter is merged.
 */
interface PendingFamily {
  readonly family: OperationFamily;
  readonly stores: readonly OperationStore[];
  /** The family's own status and recovery commands; empty when it has none. */
  readonly commands: readonly string[];
  readonly abandon?: (context: RuntimeContext, operationId: string) => Promise<unknown>;
}
const flat = (directory: string): OperationStore => ({ directory, perProfile: false });
const perProfile = (directory: string): OperationStore => ({ directory, perProfile: true });
const PENDING: readonly PendingFamily[] = [
  { family: "swap", stores: [perProfile("swap-operations")], commands: [
    "apn swap ethereum uniswap status --operation <operation-id>", "apn swap tron sunswap status --operation <operation-id>",
    "apn swap solana jupiter status --operation <operation-id>", "apn swap solana orca status --operation <operation-id>",
    "apn swap solana orca stable-status --operation <operation-id>"],
  // A marked swap with no provable bound has an owner exit (R4).
  abandon: async (context, operationId) => await abandonSwapOperation(context, operationId) },
  { family: "uniswap_token", stores: [flat("uniswap-token-operations")], commands: ["apn swap ethereum uniswap-token status --operation <operation-id>"] },
  { family: "stargate_native", stores: [flat("stargate-v2-native")], commands: ["apn stargate native status --operation <operation-id>"] },
  { family: "stargate_token", stores: [flat("stargate-v2-token")], commands: ["apn stargate token status --operation <operation-id>"] },
  { family: "gasless_usdt", stores: [perProfile("gasless-usdt-bound-operations"), flat("gasless-usdt-executions")],
    commands: ["apn gasless usdt status --profile-hash <profile-hash> --operation <operation-id>"] },
  { family: "oneclick_source", stores: [flat("oneclick-source")], commands: ["apn oneclick source status --operation <operation-id>"] },
  // The CCTP Base to Solana source has no status command of its own yet.
  { family: "circle_source", stores: [perProfile("non-evm-source-journals")], commands: [] },
  { family: "circle_approval", stores: [flat("circle-approvals")], commands: ["apn circle approval status --operation <operation-id>"] },
  { family: "metamask_native", stores: [flat("metamask-native-operations")],
    commands: ["apn wallet metamask native-transfer-status --operation <operation-id>"],
    abandon: async (context, operationId) => await abandonMetaMaskNativeTransfer(context.state.root, operationId,
      async intent => await context.requireOperationAbandonApproval().approve(intent), () => context.clock.now()) },
];

/** The unregistered family that holds a record named for this operation, by directory names only. */
async function pendingFamily(root: string, registry: OperationRegistry, operationId: string): Promise<PendingFamily | null> {
  for (const pending of PENDING) {
    if (registry.has(pending.family)) continue;
    for (const store of pending.stores) if (await named(root, store, operationId)) return pending;
  }
  return null;
}

/** `operation status|resume` and `receipt get` for an ID the index does not hold. */
export async function pendingFamilyAnswer(root: string, registry: OperationRegistry, operationId: string): Promise<never> {
  const pending = await pendingFamily(root, registry, operationId);
  if (pending === null) throw notFound(registry);
  throw new ApnError("APN_UNSUPPORTED_COMMAND",
    `This ${pending.family} operation exists, but the generic operation commands do not read its family yet; ${pending.commands.length === 0
      ? "the family has no status command yet." : "use its own command."}`,
    { reason: "operation_kind_not_covered", family: pending.family, operationId,
      nextActions: pending.commands.map(command => command.replaceAll("<operation-id>", operationId)) });
}

/** `operation abandon` for an ID the index does not hold: the family's existing owner exit, or its own commands. */
export async function pendingFamilyAbandon(context: RuntimeContext, registry: OperationRegistry, operationId: string): Promise<unknown> {
  const pending = await pendingFamily(context.state.root, registry, operationId);
  if (pending?.abandon !== undefined) return await pending.abandon(context, operationId);
  return await pendingFamilyAnswer(context.state.root, registry, operationId);
}

function notFound(registry: OperationRegistry): ApnError {
  return new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.", { covered_families: [...registry.keys()] });
}

async function named(root: string, store: OperationStore, operationId: string): Promise<boolean> {
  const directory = join(root, store.directory), name = `${operationId}.json`;
  if (!store.perProfile) return await isFile(join(directory, name));
  for (const profile of await listing(directory)) {
    if (profile.isDirectory() && /^[a-f0-9]{64}$/u.test(profile.name) && await isFile(join(directory, profile.name, name))) return true;
  }
  return false;
}
async function isFile(path: string): Promise<boolean> {
  try { return (await lstat(path)).isFile(); } catch { return false; }
}
async function listing(directory: string) {
  try { return await readdir(directory, { withFileTypes: true }); } catch { return []; }
}
