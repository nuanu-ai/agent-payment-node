import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import type { CommandRequest, OutputEnvelope } from "./core.js";
import { ApnCore } from "./core.js";
import { catalogNextActions, parseCatalogArgv } from "./command-catalog.js";
import { OUTPUT_VERSION } from "./constants.js";
import { ApnError, asApnError } from "./errors.js";
import { LocalWalletNative } from "./local-wallet-native.js";
import { MacOSLoginKeychainSecret, type WrappingSecretPort } from "./macos-keychain.js";
import type { NativePort } from "./ports.js";
import type { ProfilePolicyPort } from "./profile-policy.js";
import { EncryptedProfilePolicy } from "./encrypted-profile-policy.js";
import { TtyProfilePolicyApproval, type ProfilePolicyApprovalPort } from "./policy-approval.js";
import { HttpsBaseRpc } from "./rpc.js";
import { StateStore } from "./state.js";
import type { TransferApprovalPort } from "./tty-approval.js";
import { HttpsX402Http } from "./x402-http.js";

interface ParsedCli { readonly request: CommandRequest; readonly rpcUrl?: string }

export function parseArgv(argv: readonly string[]): ParsedCli {
  const parsed = parseCatalogArgv(argv);
  const options = parsed.values;
  switch (parsed.command.path.join(" ")) {
    case "--version": return { request: { command: "version" } };
    case "doctor keychain": return { request: { command: "doctor.keychain" } };
    case "wallet ensure": return { request: { command: "wallet.ensure", profile: value(options, "--profile") } };
    case "wallet status": return { request: { command: "wallet.status", profile: value(options, "--profile") } };
    case "wallet balance": return {
      request: { command: "wallet.balance", profile: value(options, "--profile") },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "wallet policy show": return { request: { command: "wallet.policy.show", profile: value(options, "--profile") } };
    case "wallet policy set": return {
      request: {
        command: "wallet.policy.set",
        profile: value(options, "--profile"),
        maxBalanceUsdcAtomic: value(options, "--max-balance-usdc-atomic"),
        maxX402AmountAtomic: value(options, "--max-x402-amount-atomic"),
        ...(options["--max-balance-eth-wei"] === undefined ? {} : { maxBalanceEthWei: options["--max-balance-eth-wei"] }),
      },
    };
    case "x402 inspect": return { request: { command: "x402.inspect", url: value(options, "--url") } };
    case "x402 fetch prepare": return {
      request: {
        command: "x402.fetch.prepare",
        profile: value(options, "--profile"),
        url: value(options, "--url"),
        ...(options["--max-amount-atomic"] === undefined ? {} : { maxAmountAtomic: options["--max-amount-atomic"] }),
        idempotencyKey: value(options, "--idempotency-key"),
      },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "x402 fetch approve": return {
      request: { command: "x402.fetch.approve", operationId: value(options, "--operation") },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "pay transfer prepare": return {
      request: {
        command: "transfer.prepare",
        profile: value(options, "--profile"),
        idempotencyKey: value(options, "--idempotency-key"),
        recipient: value(options, "--to"),
        amount: value(options, "--amount-usdc"),
      },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "pay transfer approve": return {
      request: { command: "transfer.approve", operationId: value(options, "--operation") },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "operation status": return { request: { command: "operation.status", operationId: value(options, "--operation") } };
    case "operation resume": return {
      request: {
        command: "operation.resume",
        operationId: value(options, "--operation"),
        ...(options["--wait-seconds"] === undefined ? {} : { waitSeconds: Number(options["--wait-seconds"]) }),
      },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "receipt get": return { request: { command: "receipt.get", operationId: value(options, "--operation") } };
    default: throw new ApnError("APN_INTERNAL", "The command catalog has no request binding.");
  }
}

export interface CliRuntimeOptions {
  readonly stateRoot?: string;
  readonly native?: NativePort;
  readonly wrappingSecret?: WrappingSecretPort;
  readonly approval?: TransferApprovalPort;
  readonly policy?: ProfilePolicyPort;
  readonly policyApproval?: ProfilePolicyApprovalPort;
}

export async function runCli(
  argv: readonly string[],
  _environment: NodeJS.ProcessEnv = process.env,
  options: CliRuntimeOptions = {},
): Promise<OutputEnvelope> {
  try {
    const parsed = parseArgv(argv);
    const stateRoot = options.stateRoot ?? effectiveStateRoot();
    const state = new StateStore(stateRoot);
    const wrappingSecret = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
    const native = needsNative(parsed.request)
      ? options.native ?? new LocalWalletNative(
          state,
          wrappingSecret,
          options.approval,
        )
      : undefined;
    const policy = needsPolicy(parsed.request)
      ? options.policy ?? new EncryptedProfilePolicy(
          state,
          wrappingSecret,
          options.policyApproval ?? new TtyProfilePolicyApproval(),
        )
      : undefined;
    const rpc = parsed.rpcUrl === undefined ? undefined : new HttpsBaseRpc(parsed.rpcUrl);
    const http = ["x402.inspect", "x402.fetch.prepare", "operation.resume"].includes(parsed.request.command)
      ? new HttpsX402Http()
      : undefined;
    return await new ApnCore({
      state,
      ...(native === undefined ? {} : { native }),
      ...(parsed.request.command === "doctor.keychain" ? { keychainProbe: wrappingSecret } : {}),
      ...(rpc === undefined ? {} : { rpc }),
      ...(http === undefined ? {} : { http }),
      ...(policy === undefined ? {} : { policy }),
    }).execute(parsed.request);
  } catch (error) {
    const safe = asApnError(error);
    return {
      version: OUTPUT_VERSION,
      request_id: randomUUID(),
      command: "invalid",
      ok: false,
      proof_class: "classified_failure",
      data: null,
      operation: null,
      receipt: null,
      error: { code: safe.code, message: safe.message, ...(safe.details === undefined ? {} : { details: safe.details }) },
      next_actions: catalogNextActions(argv),
    };
  }
}

export function effectiveStateRoot(): string {
  return resolve(userInfo().homedir, ".apn");
}

function needsNative(request: CommandRequest): boolean {
  return [
    "doctor.keychain", "wallet.ensure", "wallet.status", "transfer.approve", "x402.fetch.approve", "operation.resume",
  ].includes(request.command);
}
function needsPolicy(request: CommandRequest): boolean {
  return ["wallet.balance", "wallet.policy.show", "wallet.policy.set", "x402.fetch.prepare"].includes(request.command);
}
function value(options: Readonly<Record<string, string>>, name: string): string {
  const selected = options[name];
  if (selected === undefined) throw new ApnError("APN_INTERNAL", "The command catalog omitted a required request binding.");
  return selected;
}
