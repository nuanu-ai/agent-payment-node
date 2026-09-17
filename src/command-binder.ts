import { isPlainRecord } from "./canonical.js";
import {
  parseCatalogArgv,
  parseCatalogInput,
  type CommandDefinition,
  type ParsedCatalogCommand,
} from "./command-catalog.js";
import type { CommandRequest } from "./commands.js";
import { ApnError } from "./errors.js";
import { evmChain, evmDecimals, evmToken, type EvmAssetSelection } from "./evm-asset.js";
import { bindX402HttpRequest } from "./x402-http-request.js";
import { chainDecimal } from "./chain-policy.js";
import { solanaAddress } from "./solana/rpc.js";
import { tronAddress } from "./tron/codec.js";
import { bindBridgeCommand } from "./lifi/command-catalog.js";
import { bindOneClickCommand } from "./lifi/near-oneclick-command-catalog.js";
import { bindCircleCommand } from "./lifi/circle-command-catalog.js";
import { bindGaslessCommand } from "./gasless/command-catalog.js";
import { gaslessObservationRpcEnv } from "./gasless/observation-source.js";

export interface BoundCommand {
  readonly request: CommandRequest;
  readonly rpcUrl?: string;
}

export function bindArgv(argv: readonly string[]): BoundCommand {
  return bindParsedCatalog(parseCatalogArgv(argv));
}

export function bindMcpInput(command: CommandDefinition, input: unknown): BoundCommand {
  if (!isPlainRecord(input)) {
    throw new ApnError("APN_INVALID_INPUT", "Tool input must be an object.");
  }
  const byField = new Map<string, CommandDefinition["options"][number]>();
  for (const option of command.options) {
    const field = mcpFieldName(option.name);
    if (byField.has(field)) throw new ApnError("APN_INTERNAL", "Command options collide after MCP projection.");
    byField.set(field, option);
  }
  const catalogInput: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    const option = byField.get(field);
    if (option === undefined) throw new ApnError("APN_INVALID_INPUT", "Tool input contains an unknown field.");
    catalogInput[option.name] = value;
  }
  return bindParsedCatalog(parseCatalogInput(command, catalogInput));
}

export function mcpFieldName(optionName: `--${string}`): string {
  const field = optionName.slice(2).replaceAll("-", "_");
  if (!/^[a-z][a-z0-9_]*$/u.test(field)) {
    throw new ApnError("APN_INTERNAL", "Command option cannot be projected to a safe MCP field.");
  }
  return field;
}

function bindParsedCatalog(parsed: ParsedCatalogCommand): BoundCommand {
  const options = parsed.values;
  if (parsed.command.path[0] === "gasless") return { request: bindGaslessCommand(parsed.command.path.join(" "), options) };
  if (parsed.command.path[0] === "bridge") return { request: bindBridgeCommand(parsed.command.path.join(" "), options) };
  if (parsed.command.path[0] === "oneclick") return { request: bindOneClickCommand(parsed.command.path.join(" "), options) };
  if (parsed.command.path[0] === "circle") return { request: bindCircleCommand(parsed.command.path.join(" "), options) };
  switch (parsed.command.path.join(" ")) {
    case "allowlist inventory": return { request: { command: "allowlist.inventory" } };
    case "allowlist resolve": {
      const kind = value(options, "--kind");
      if (kind !== "native" && kind !== "token") throw new ApnError("APN_ALLOWLIST_IDENTITY_INVALID", "Asset kind must be exactly native or token.", { reason: "invalid_kind" });
      return { request: { command: "allowlist.resolve", chain: value(options, "--chain"), kind,
        ...(options["--identifier"] === undefined ? {} : { identifier: options["--identifier"] }) } };
    }
    case "allowlist policy status": return { request: { command: "allowlist.policy.status", profile: value(options, "--profile") } };
    case "allowlist policy prepare": {
      const kind = value(options, "--kind");
      if (kind !== "native" && kind !== "token") throw new ApnError("APN_ALLOWLIST_IDENTITY_INVALID", "Asset kind must be exactly native or token.", { reason: "invalid_kind" });
      const rail = value(options, "--rail");
      if (rail !== "direct" && rail !== "gasless" && rail !== "x402" && rail !== "bridge" && rail !== "swap") {
        throw new ApnError("APN_INVALID_INPUT", "Allowlist policy rail is invalid.", { reason: "invalid_rail" });
      }
      const expected = options["--expected-revision"];
      if (expected !== undefined && (!/^[1-9][0-9]*$/u.test(expected) || !Number.isSafeInteger(Number(expected)))) {
        throw new ApnError("APN_INVALID_INPUT", "Expected revision must be a positive safe integer.", { reason: "invalid_revision" });
      }
      return { request: { command: "allowlist.policy.prepare", profile: value(options, "--profile"),
        account: value(options, "--account"), overlayVersion: value(options, "--overlay-version"),
        chain: value(options, "--chain"), kind, ...(options["--identifier"] === undefined ? {} : { identifier: options["--identifier"] }),
        rail, maximumPerTransferAtomic: value(options, "--max-per-transfer-atomic"),
        dailyLimitAtomic: value(options, "--daily-limit-atomic"), effectiveAt: value(options, "--effective-at"),
        ...(options["--expires-at"] === undefined ? {} : { expiresAt: options["--expires-at"] }),
        ...(options["--mechanism-provider"] === undefined ? {} : { mechanismProvider: options["--mechanism-provider"] }),
        ...(options["--mechanism-reference"] === undefined ? {} : { mechanismReference: options["--mechanism-reference"] }),
        ...(expected === undefined ? {} : { expectedRevision: Number(expected) }) } };
    }
    case "--version": return { request: { command: "version" } };
    case "doctor keychain": return { request: { command: "doctor.keychain" } };
    case "wallet ensure-tron": {
      if (value(options, "--provider") !== "local" || value(options, "--accept-risk") !== "true") throw new ApnError("APN_INVALID_INPUT", "TRON requires the explicit local provider and literal true risk acknowledgement.");
      return { request: { command: "wallet.ensure-tron", profile: value(options, "--profile"), provider: "local", acceptRisk: true } };
    }
    case "wallet balance-tron": return { request: { command: "wallet.balance-tron", profile: value(options, "--profile"), asset: tronAsset(options) } };
    case "wallet capabilities-tron": return { request: { command: "wallet.capabilities-tron", ...(options["--profile"] === undefined ? {} : { profile: options["--profile"] }) } };
    case "policy admit-tron": {
      const asset = tronAsset(options);
      for (const key of ["--max-per-transfer", "--daily-limit", "--max-fee-trx"]) chainDecimal(value(options, key), 6);
      return { request: { command: "policy.admit-tron", profile: value(options, "--profile"), asset, maximumPerTransfer: value(options, "--max-per-transfer"), dailyLimit: value(options, "--daily-limit"), maximumFee: value(options, "--max-fee-trx") } };
    }
    case "pay transfer prepare-tron": {
      const asset = tronAsset(options); chainDecimal(value(options, "--amount"), 6); chainDecimal(value(options, "--max-fee-trx"), 6);
      return { request: { command: "transfer.prepare-tron", profile: value(options, "--profile"), asset, recipient: tronAddress(value(options, "--to")), amount: value(options, "--amount"), maximumFee: value(options, "--max-fee-trx"), idempotencyKey: value(options, "--idempotency-key") } };
    }
    case "wallet ensure-solana": {
      const provider = value(options, "--provider");
      if (provider !== "local" && provider !== "coinbase-awal") throw new ApnError("APN_INVALID_INPUT", "Solana supports only the explicit local or coinbase-awal execution owner.");
      if (options["--accept-risk"] !== undefined && options["--accept-risk"] !== "true") throw new ApnError("APN_INVALID_INPUT", "Local risk acknowledgement must be the literal true.");
      return { request: { command: "wallet.ensure-solana", profile: value(options, "--profile"), provider, acceptRisk: options["--accept-risk"] === "true" } };
    }
    case "wallet balance-solana": return { request: { command: "wallet.balance-solana", profile: value(options, "--profile"), asset: solanaAsset(options) } };
    case "wallet capabilities-solana": return { request: { command: "wallet.capabilities-solana", ...(options["--profile"] === undefined ? {} : { profile: options["--profile"] }) } };
    case "policy admit-solana": {
      const asset = solanaAsset(options); const decimals = asset === "sol" ? 9 : 6;
      chainDecimal(value(options, "--max-per-transfer"), decimals); chainDecimal(value(options, "--daily-limit"), decimals); chainDecimal(value(options, "--max-fee-sol"), 9);
      return { request: { command: "policy.admit-solana", profile: value(options, "--profile"), asset,
        maximumPerTransfer: value(options, "--max-per-transfer"), dailyLimit: value(options, "--daily-limit"), maximumFee: value(options, "--max-fee-sol") } };
    }
    case "pay transfer prepare-solana": {
      const asset = solanaAsset(options);
      chainDecimal(value(options, "--amount"), asset === "sol" ? 9 : 6); chainDecimal(value(options, "--max-fee-sol"), 9);
      return { request: { command: "transfer.prepare-solana", profile: value(options, "--profile"), asset,
        recipient: solanaAddress(value(options, "--to")), amount: value(options, "--amount"), maximumFee: value(options, "--max-fee-sol"), idempotencyKey: value(options, "--idempotency-key") } };
    }
    case "wallet ensure": return { request: { command: "wallet.ensure", profile: value(options, "--profile") } };
    case "wallet import": return { request: { command: "wallet.import", profile: value(options, "--profile"),
      keyFile: value(options, "--key-file"), keyName: value(options, "--key-name"), expectedAddress: value(options, "--expected-address") } };
    case "wallet connect": return {
      request: {
        command: "wallet.connect",
        profile: value(options, "--profile"),
        providerId: value(options, "--provider"),
        ...(options["--auth-method"] === undefined
          ? {}
          : { authenticationMethod: options["--auth-method"] }),
        ...(options["--expected-revision"] === undefined
          ? {}
          : { expectedRevision: Number(options["--expected-revision"]) }),
        ...(options["--permission-cap-usdc-atomic"] === undefined
          ? {}
          : { permissionCapUsdcAtomic: options["--permission-cap-usdc-atomic"] }),
        ...(options["--permission-expires-at"] === undefined
          ? {}
          : { permissionExpiresAt: Number(options["--permission-expires-at"]) }),
        ...(options["--idempotency-key"] === undefined
          ? {}
          : { idempotencyKey: options["--idempotency-key"] }),
      },
    };
    case "wallet permission list": return {
      request: { command: "wallet.permission.list", profile: value(options, "--profile") },
    };
    case "wallet permission sync": return {
      request: {
        command: "wallet.permission.sync",
        profile: value(options, "--profile"),
        expectedRevision: Number(value(options, "--expected-revision")),
      },
    };
    case "wallet permission disable": return {
      request: {
        command: "wallet.permission.disable",
        profile: value(options, "--profile"),
        expectedRevision: Number(value(options, "--expected-revision")),
      },
    };
    case "wallet permission forget": return {
      request: {
        command: "wallet.permission.forget",
        profile: value(options, "--profile"),
        expectedRevision: Number(value(options, "--expected-revision")),
      },
    };
    case "wallet status": return { request: { command: "wallet.status", profile: value(options, "--profile") } };
    case "wallet balance": return {
      request: { command: "wallet.balance", profile: value(options, "--profile") },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "wallet balance-asset": return {
      request: { command: "wallet.balance", profile: value(options, "--profile"), asset: bindAsset(options) },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "wallet policy show-network":
    case "wallet policy show": return { request: { command: "wallet.policy.show", profile: value(options, "--profile"), ...bindNetwork(options) } };
    case "wallet policy set-network":
    case "wallet policy set": return {
      request: {
        command: "wallet.policy.set",
        ...bindNetwork(options),
        profile: value(options, "--profile"),
        maxBalanceUsdcAtomic: value(options, "--max-balance-usdc-atomic"),
        maxX402AmountAtomic: value(options, "--max-x402-amount-atomic"),
        ...(options["--max-balance-eth-wei"] === undefined ? {} : { maxBalanceEthWei: options["--max-balance-eth-wei"] }),
      },
    };
    case "x402 inspect-network":
    case "x402 inspect": return { request: { command: "x402.inspect", url: value(options, "--url"), ...bindX402HttpRequest(options), ...bindNetwork(options) } };
    case "x402 fetch prepare-network":
    case "x402 fetch prepare": return {
      request: {
        command: "x402.fetch.prepare",
        ...bindNetwork(options),
        ...bindX402HttpRequest(options),
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
    case "pay transfer prepare-asset": return {
      request: {
        command: "transfer.prepare", profile: value(options, "--profile"), asset: bindAsset(options),
        recipient: value(options, "--to"), amount: value(options, "--amount"), maxFeeWei: value(options, "--max-fee-wei"),
        idempotencyKey: value(options, "--idempotency-key"),
      },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "pay transfer approve": return {
      request: { command: "transfer.approve", operationId: value(options, "--operation") },
      ...(options["--rpc-url"] === undefined ? {} : { rpcUrl: options["--rpc-url"] }),
    };
    case "operation status": return { request: { command: "operation.status", operationId: value(options, "--operation") } };
    case "operation abandon": return { request: { command: "operation.abandon", operationId: value(options, "--operation") } };
    case "operation resume": {
      const observationRpcEnv = options["--observation-rpc-env"] === undefined ? undefined
        : gaslessObservationRpcEnv(options["--observation-rpc-env"]);
      if (observationRpcEnv !== undefined && (options["--rpc-url"] !== undefined || options["--wait-seconds"] !== undefined)) {
        throw new ApnError("APN_INVALID_INPUT", "Observation RPC recovery cannot be combined with --rpc-url or --wait-seconds.",
          { reason: "gasless_observation_rpc_options" });
      }
      return {
        request: {
          command: "operation.resume",
          operationId: value(options, "--operation"),
          ...(options["--wait-seconds"] === undefined ? {} : { waitSeconds: Number(options["--wait-seconds"]) }),
          ...(observationRpcEnv === undefined ? {} : { observationRpcEnv }),
        },
        ...(options["--rpc-url"] === undefined ? {} : { rpcUrl: options["--rpc-url"] }),
      };
    }
    case "operation recover-provider-request": return {
      request: {
        command: "operation.recover-provider-request",
        operationId: value(options, "--operation"),
        providerRequestId: value(options, "--provider-request-id"),
      },
    };
    case "operation recover-transaction-settlement": return {
      request: {
        command: "operation.recover-transaction-settlement",
        operationId: value(options, "--operation"),
        transactionHash: value(options, "--transaction-hash"),
        idempotencyKey: value(options, "--idempotency-key"),
      },
      rpcUrl: value(options, "--rpc-url"),
    };
    case "receipt get": return { request: { command: "receipt.get", operationId: value(options, "--operation") } };
    default: throw new ApnError("APN_INTERNAL", "The command catalog has no request binding.");
  }
}

function solanaAsset(options: Readonly<Record<string, string>>): "sol" | "usdc" {
  const asset = value(options, "--asset");
  if (asset !== "sol" && asset !== "usdc") throw new ApnError("APN_INVALID_INPUT", "Select the explicit sol or usdc asset alias.");
  return asset;
}
function tronAsset(options: Readonly<Record<string, string>>): "trx" | "usdt" {
  const asset = value(options, "--asset");
  if (asset !== "trx" && asset !== "usdt") throw new ApnError("APN_INVALID_INPUT", "Select the explicit trx or usdt asset alias.");
  return asset;
}

function bindNetwork(options: Readonly<Record<string, string>>) {
  return options["--chain"] === undefined ? {} : { chainId: evmChain(options["--chain"]) };
}

function bindAsset(options: Readonly<Record<string, string>>): EvmAssetSelection {
  const decimals = options["--decimals"];
  if (decimals !== undefined && !/^(?:0|[1-9][0-9]{0,2})$/u.test(decimals)) throw new ApnError("APN_INVALID_INPUT", "Asset decimals must be a canonical integer from 0 through 255.");
  return {
    chainId: evmChain(value(options, "--chain")), token: evmToken(value(options, "--asset")),
    ...(decimals === undefined ? {} : { decimals: evmDecimals(Number(decimals)) }),
  };
}

function value(options: Readonly<Record<string, string>>, name: string): string {
  const selected = options[name];
  if (selected === undefined) throw new ApnError("APN_INTERNAL", "The command catalog omitted a required request binding.");
  return selected;
}
