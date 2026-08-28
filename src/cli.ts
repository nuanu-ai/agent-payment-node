import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import type { CommandRequest, OutputEnvelope } from "./core.js";
import { ApnCore } from "./core.js";
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
  const [first, second, third, ...rest] = argv;
  if (first === "--version") return noArguments([second, third, ...rest].filter(defined), { command: "version" });
  if (first === "doctor" && second === "keychain") return noArguments([third, ...rest].filter(defined), { command: "doctor.keychain" });
  if (first === "wallet" && (second === "ensure" || second === "status")) {
    const options = parseOptions([third, ...rest].filter(defined), ["profile"]);
    return { request: { command: `wallet.${second}`, profile: options.profile ?? "default" } };
  }
  if (first === "wallet" && second === "balance") {
    const options = parseOptions([third, ...rest].filter(defined), ["profile", "rpc-url"]);
    return { request: { command: "wallet.balance", profile: options.profile ?? "default" }, rpcUrl: required(options, "rpc-url") };
  }
  if (first === "wallet" && second === "policy" && third === "show") {
    const options = parseOptions(rest, ["profile"]);
    return { request: { command: "wallet.policy.show", profile: required(options, "profile") } };
  }
  if (first === "wallet" && second === "policy" && third === "set") {
    const options = parseOptions(rest, ["profile", "max-balance-usdc-atomic", "max-x402-amount-atomic", "max-balance-eth-wei"]);
    return {
      request: {
        command: "wallet.policy.set",
        profile: required(options, "profile"),
        maxBalanceUsdcAtomic: required(options, "max-balance-usdc-atomic"),
        maxX402AmountAtomic: required(options, "max-x402-amount-atomic"),
        ...(options["max-balance-eth-wei"] === undefined ? {} : { maxBalanceEthWei: options["max-balance-eth-wei"] }),
      },
    };
  }
  if (first === "x402" && second === "inspect") {
    const options = parseOptions([third, ...rest].filter(defined), ["url"]);
    return { request: { command: "x402.inspect", url: required(options, "url") } };
  }
  if (first === "x402" && second === "fetch" && third === "prepare") {
    const options = parseOptions(rest, ["profile", "url", "max-amount-atomic", "idempotency-key", "rpc-url"]);
    return {
      request: {
        command: "x402.fetch.prepare",
        profile: required(options, "profile"),
        url: required(options, "url"),
        ...(options["max-amount-atomic"] === undefined ? {} : { maxAmountAtomic: options["max-amount-atomic"] }),
        idempotencyKey: required(options, "idempotency-key"),
      },
      rpcUrl: required(options, "rpc-url"),
    };
  }
  if (first === "x402" && second === "fetch" && third === "approve") {
    const options = parseOptions(rest, ["operation", "rpc-url"]);
    return {
      request: { command: "x402.fetch.approve", operationId: required(options, "operation") },
      rpcUrl: required(options, "rpc-url"),
    };
  }
  if (first === "pay" && second === "transfer" && third === "prepare") {
    const options = parseOptions(rest, ["profile", "idempotency-key", "to", "amount-usdc", "rpc-url"]);
    return {
      request: {
        command: "transfer.prepare",
        profile: required(options, "profile"),
        idempotencyKey: required(options, "idempotency-key"),
        recipient: required(options, "to"),
        amount: required(options, "amount-usdc"),
      },
      rpcUrl: required(options, "rpc-url"),
    };
  }
  if (first === "pay" && second === "transfer" && third === "approve") {
    const options = parseOptions(rest, ["operation", "rpc-url"]);
    return { request: { command: "transfer.approve", operationId: required(options, "operation") }, rpcUrl: required(options, "rpc-url") };
  }
  if (first === "operation" && (second === "status" || second === "resume")) {
    const options = parseOptions([third, ...rest].filter(defined), second === "resume" ? ["operation", "rpc-url", "wait-seconds"] : ["operation"]);
    return {
      request: second === "resume" ? {
        command: "operation.resume",
        operationId: required(options, "operation"),
        ...(options["wait-seconds"] === undefined ? {} : { waitSeconds: parseWaitSeconds(options["wait-seconds"]) }),
      } : { command: "operation.status", operationId: required(options, "operation") },
      ...(second === "resume" ? { rpcUrl: required(options, "rpc-url") } : {}),
    };
  }
  if (first === "receipt" && second === "get") {
    const options = parseOptions([third, ...rest].filter(defined), ["operation"]);
    return { request: { command: "receipt.get", operationId: required(options, "operation") } };
  }
  throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported APN command.");
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
      next_actions: [],
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
function noArguments(rest: readonly string[], request: CommandRequest): ParsedCli {
  if (rest.length !== 0) throw new ApnError("APN_INVALID_INPUT", "This command accepts no arguments.");
  return { request };
}
function parseOptions(argv: readonly string[], allowed: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === undefined || value === undefined || !option.startsWith("--")) throw new ApnError("APN_INVALID_INPUT", "Options must use `--name value` pairs.");
    const name = option.slice(2);
    if (!allowed.includes(name) || name in result || value.startsWith("--")) throw new ApnError("APN_INVALID_INPUT", "Command contains an unknown, duplicate, or missing option.");
    result[name] = value;
  }
  return result;
}
function required(options: Readonly<Record<string, string>>, name: string): string {
  const value = options[name];
  if (value === undefined) throw new ApnError("APN_INVALID_INPUT", `Missing required --${name} option.`);
  return value;
}
function parseWaitSeconds(value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new ApnError("APN_INVALID_INPUT", "--wait-seconds must be a canonical integer from 1 through 300.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 300) {
    throw new ApnError("APN_INVALID_INPUT", "--wait-seconds must be a canonical integer from 1 through 300.");
  }
  return parsed;
}
function defined(value: string | undefined): value is string { return value !== undefined; }
