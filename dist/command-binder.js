import { coinbaseObservationPreset } from "./coinbase-gasless-observation-source.js";
import { bindGaszipFundingCommand } from "./lifi/gaszip-direct-command-catalog.js";
import { bindCircleEvmCommand } from "./circle-v2-evm/command-catalog.js";
import { isPlainRecord } from "./canonical.js";
import { parseCatalogArgv, parseCatalogInput, } from "./command-catalog.js";
import { ApnError } from "./errors.js";
import { evmDecimals, evmToken } from "./evm-asset.js";
import { solanaAccount, x402Chain, X402_SOLANA_POLICY_NETWORK } from "./x402-network.js";
import { listedEvmAsset } from "./evm-direct-allowlist.js";
import { directEvmChain } from "./evm-direct-networks.js";
import { bindX402HttpRequest } from "./x402-http-request.js";
import { chainDecimal } from "./chain-policy.js";
import { X402_PAYEES_UNRESTRICTED } from "./profile-policy.js";
import { solanaAddress } from "./solana/rpc.js";
import { tronAddress } from "./tron/codec.js";
import { bindBridgeCommand } from "./lifi/command-catalog.js";
import { bindOneClickCommand } from "./lifi/near-oneclick-command-catalog.js";
import { bindCircleCommand } from "./lifi/circle-command-catalog.js";
import { bindGaslessCommand } from "./gasless/command-catalog.js";
import { gaslessObservationRpcEnv } from "./gasless/observation-source.js";
import { bindUniswapCommand } from "./swap/uniswap-command-catalog.js";
import { bindUniswapTokenCommand } from "./swap/uniswap-token-command-catalog.js";
import { bindSunSwapCommand } from "./swap/sunswap-tron/command-catalog.js";
import { bindJupiterCommand } from "./swap/jupiter-solana/command-catalog.js";
import { bindOrcaCommand } from "./swap/orca-solana/command-catalog.js";
import { bindX402SolanaCommand } from "./x402-solana/command-catalog.js";
import { bindPermit2AllowanceCommand } from "./x402-permit2/allowance/catalog.js";
import { bindWalletAllowanceCommand } from "./wallet-allowance/catalog.js";
import { bindAllowlistCommand } from "./allowlist-command-catalog.js";
import { bindRelayPrepare } from "./relay/command-route.js";
export function bindArgv(argv) {
    return bindParsedCatalog(parseCatalogArgv(argv));
}
export function bindMcpInput(command, input) {
    if (!isPlainRecord(input)) {
        throw new ApnError("APN_INVALID_INPUT", "Tool input must be an object.");
    }
    const byField = new Map();
    for (const option of command.options) {
        const field = mcpFieldName(option.name);
        if (byField.has(field))
            throw new ApnError("APN_INTERNAL", "Command options collide after MCP projection.");
        byField.set(field, option);
    }
    const catalogInput = {};
    for (const [field, value] of Object.entries(input)) {
        const option = byField.get(field);
        if (option === undefined)
            throw new ApnError("APN_INVALID_INPUT", "Tool input contains an unknown field.");
        if (option.type === "boolean" && typeof value !== "boolean")
            throw new ApnError("APN_INVALID_INPUT", "Tool boolean input must be a boolean.");
        catalogInput[option.name] = value;
    }
    return bindParsedCatalog(parseCatalogInput(command, catalogInput));
}
export function mcpFieldName(optionName) {
    const field = optionName.slice(2).replaceAll("-", "_");
    if (!/^[a-z][a-z0-9_]*$/u.test(field)) {
        throw new ApnError("APN_INTERNAL", "Command option cannot be projected to a safe MCP field.");
    }
    return field;
}
function bindParsedCatalog(parsed) {
    const options = parsed.values;
    if (parsed.command.path.join(" ") === "x402 permit2 approve")
        return { request: { command: "x402.permit2.approve",
                profile: value(options, "--profile"), url: value(options, "--url"), idempotencyKey: value(options, "--idempotency-key") }, rpcUrl: value(options, "--rpc-url") };
    if (parsed.command.path.join(" ") === "x402 permit2 observe") {
        if (options["--transaction"] !== undefined && options["--expired-unused"] === "true")
            throw new ApnError("APN_INVALID_INPUT", "Permit2 observation modes are mutually exclusive.");
        if (options["--transaction"] !== undefined && /^0x0{64}$/u.test(value(options, "--transaction")))
            throw new ApnError("APN_INVALID_INPUT", "Permit2 transaction locator must be nonzero.");
        return { request: { command: "x402.permit2.observe", operationId: value(options, "--operation"),
                ...(options["--profile"] === undefined ? {} : { profile: value(options, "--profile") }),
                ...(options["--transaction"] === undefined ? {} : { transaction: value(options, "--transaction") }), expiredUnused: options["--expired-unused"] === "true" }, rpcUrl: value(options, "--rpc-url") };
    }
    if (parsed.command.path.join(" ") === "x402 permit2 preflight")
        return { request: {
                command: "x402.permit2.preflight", profile: value(options, "--profile"),
                paymentRequired: value(options, "--payment-required"),
                expectedChallengeHash: value(options, "--expected-challenge-hash"),
                expectedIndex: value(options, "--expected-index"), expectedTerms: value(options, "--expected-terms")
            },
            rpcUrl: value(options, "--rpc-url") };
    if (parsed.command.path.join(" ") === "x402 merchant prepare")
        return { request: { command: "x402.merchant.prepare", profile: value(options, "--profile"), url: value(options, "--url"), ...(options["--asset"] === undefined ? {} : { asset: options["--asset"] }), maximumNativeFee: value(options, "--max-native-fee-wei"), ...(options["--native-fee-reserve-wei"] === undefined ? {} : { nativeFeeReserveWei: value(options, "--native-fee-reserve-wei") }), idempotencyKey: value(options, "--idempotency-key") } };
    if (parsed.command.path.join(" ") === "x402 merchant approve")
        return { request: { command: "x402.merchant.approve", operationId: value(options, "--operation") } };
    if (parsed.command.path.join(" ") === "x402 merchant observe")
        return { request: { command: "x402.merchant.observe", operationId: value(options, "--operation"), deliver: options["--deliver"] === "true" } };
    if (parsed.command.path.join(" ") === "x402 merchant retire-unsent")
        return { request: { command: "x402.merchant.retire-unsent", operationId: value(options, "--operation") } };
    if (parsed.command.path.join(" ") === "x402 merchant status")
        return { request: { command: "x402.merchant.status", operationId: value(options, "--operation") } };
    if (parsed.command.path.slice(0, 3).join(" ") === "x402 permit2 allowance")
        return bindPermit2AllowanceCommand(parsed.command.path.join(" "), options);
    if (parsed.command.path.slice(0, 2).join(" ") === "wallet allowance")
        return bindWalletAllowanceCommand(parsed.command.path.join(" "), options);
    if (parsed.command.path.slice(0, 2).join(" ") === "x402 solana")
        return { request: bindX402SolanaCommand(parsed.command.path.join(" "), options) };
    if (parsed.command.path.join(" ") === "x402 permit2 status")
        return { request: { command: "x402.permit2.status", profile: value(options, "--profile"), operationId: value(options, "--operation") } };
    if (parsed.command.path[0] === "relay")
        return bindRelayCommand(parsed.command.path.join(" "), options);
    if (parsed.command.path[0] === "stargate") {
        switch (parsed.command.path.join(" ")) {
            case "stargate native prepare": return { request: { command: "stargate.native.prepare", profile: value(options, "--profile"),
                    amountAtomic: value(options, "--amount-atomic"), maxNativeDebitAtomic: value(options, "--max-native-debit-atomic"),
                    idempotencyKey: value(options, "--idempotency-key") } };
            case "stargate native execute": return { request: { command: "stargate.native.execute", operationId: value(options, "--operation") } };
            case "stargate native observe": return { request: { command: "stargate.native.observe", operationId: value(options, "--operation") } };
            case "stargate native status": return { request: { command: "stargate.native.status", operationId: value(options, "--operation") } };
            case "stargate native receipt": return { request: { command: "stargate.native.receipt", operationId: value(options, "--operation") } };
            case "stargate token prepare": return { request: { command: "stargate.token.prepare", profile: value(options, "--profile"),
                    amountAtomic: value(options, "--amount-atomic"), nativeDropAtomic: value(options, "--native-drop-atomic"),
                    minOutputAtomic: value(options, "--min-output-atomic"), maxNativeDebitAtomic: value(options, "--max-native-debit-atomic"),
                    idempotencyKey: value(options, "--idempotency-key"),
                    ...(options["--max-fee-per-gas-wei"] === undefined ? {} : { maxFeePerGasWei: options["--max-fee-per-gas-wei"] }),
                    ...(options["--max-priority-fee-per-gas-wei"] === undefined ? {} : { maxPriorityFeePerGasWei: options["--max-priority-fee-per-gas-wei"] }) } };
            case "stargate token execute": return { request: { command: "stargate.token.execute", operationId: value(options, "--operation") } };
            case "stargate token cleanup": return { request: { command: "stargate.token.cleanup", operationId: value(options, "--operation") } };
            case "stargate token observe": return { request: { command: "stargate.token.observe", operationId: value(options, "--operation") } };
            case "stargate token status": return { request: { command: "stargate.token.status", operationId: value(options, "--operation") } };
            case "stargate token receipt": return { request: { command: "stargate.token.receipt", operationId: value(options, "--operation") } };
            default: throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported Stargate native command.");
        }
    }
    if (parsed.command.path[0] === "swap") {
        const path = parsed.command.path.join(" ");
        if (path.startsWith("swap ethereum uniswap-token "))
            return { request: bindUniswapTokenCommand(path, options) };
        if (path.startsWith("swap ethereum uniswap "))
            return { request: bindUniswapCommand(path, options) };
        if (path.startsWith("swap tron sunswap "))
            return { request: bindSunSwapCommand(path, options) };
        if (path.startsWith("swap solana jupiter "))
            return { request: bindJupiterCommand(path, options) };
        if (path.startsWith("swap solana orca "))
            return { request: bindOrcaCommand(path, options) };
        throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported guarded swap command.");
    }
    if (parsed.command.path[0] === "allowlist")
        return { request: bindAllowlistCommand(parsed.command.path.join(" "), options) };
    if (parsed.command.path[0] === "gasless")
        return { request: bindGaslessCommand(parsed.command.path.join(" "), options),
            ...(parsed.command.path.join(" ") === "gasless transfer quote" ? { rpcUrl: value(options, "--rpc-url") } : {}) };
    if (parsed.command.path[0] === "bridge")
        return { request: bindBridgeCommand(parsed.command.path.join(" "), options) };
    if (parsed.command.path[0] === "oneclick")
        return { request: bindOneClickCommand(parsed.command.path.join(" "), options) };
    if (parsed.command.path[0] === "sei")
        return { request: bindGaszipFundingCommand(parsed.command.path.join(" "), options) };
    if (parsed.command.path.slice(0, 2).join(" ") === "circle evm")
        return { request: bindCircleEvmCommand(parsed.command.path.join(" "), options) };
    if (parsed.command.path[0] === "mega")
        return { request: bindGaszipFundingCommand(parsed.command.path.join(" "), options) };
    if (parsed.command.path[0] === "circle")
        return { request: bindCircleCommand(parsed.command.path.join(" "), options) };
    switch (parsed.command.path.join(" ")) {
        case "--version": return { request: { command: "version" } };
        case "doctor keychain": return { request: { command: "doctor.keychain", profile: value(options, "--profile") } };
        case "wallet ensure-tron": {
            if (value(options, "--provider") !== "local" || value(options, "--accept-risk") !== "true")
                throw new ApnError("APN_INVALID_INPUT", "TRON requires the explicit local provider and literal true risk acknowledgement.");
            return { request: { command: "wallet.ensure-tron", profile: value(options, "--profile"), provider: "local", acceptRisk: true } };
        }
        case "wallet balance-tron": return { request: { command: "wallet.balance-tron", profile: value(options, "--profile"), asset: tronAsset(options) } };
        case "wallet capabilities-tron": return { request: { command: "wallet.capabilities-tron", ...(options["--profile"] === undefined ? {} : { profile: options["--profile"] }) } };
        case "policy admit-tron": {
            const asset = tronAsset(options);
            for (const key of ["--max-per-transfer", "--daily-limit", "--max-fee-trx"])
                chainDecimal(value(options, key), 6);
            return { request: { command: "policy.admit-tron", profile: value(options, "--profile"), asset, maximumPerTransfer: value(options, "--max-per-transfer"), dailyLimit: value(options, "--daily-limit"), maximumFee: value(options, "--max-fee-trx") } };
        }
        case "pay transfer prepare-tron": {
            const asset = tronAsset(options);
            chainDecimal(value(options, "--amount"), 6);
            chainDecimal(value(options, "--max-fee-trx"), 6);
            return { request: { command: "transfer.prepare-tron", profile: value(options, "--profile"), asset, recipient: tronAddress(value(options, "--to")), amount: value(options, "--amount"), maximumFee: value(options, "--max-fee-trx"), idempotencyKey: value(options, "--idempotency-key") } };
        }
        case "wallet ensure-solana": {
            const provider = value(options, "--provider");
            if (provider !== "local" && provider !== "coinbase-awal")
                throw new ApnError("APN_INVALID_INPUT", "Solana supports only the explicit local or coinbase-awal execution owner.");
            if (options["--accept-risk"] !== undefined && options["--accept-risk"] !== "true")
                throw new ApnError("APN_INVALID_INPUT", "Local risk acknowledgement must be the literal true.");
            return { request: { command: "wallet.ensure-solana", profile: value(options, "--profile"), provider, acceptRisk: options["--accept-risk"] === "true" } };
        }
        case "wallet balance-solana": return { request: { command: "wallet.balance-solana", profile: value(options, "--profile"), asset: solanaAsset(options) } };
        case "wallet capabilities-solana": return { request: { command: "wallet.capabilities-solana", ...(options["--profile"] === undefined ? {} : { profile: options["--profile"] }) } };
        case "policy admit-solana": {
            const asset = solanaAsset(options);
            const decimals = asset === "sol" ? 9 : 6;
            chainDecimal(value(options, "--max-per-transfer"), decimals);
            chainDecimal(value(options, "--daily-limit"), decimals);
            chainDecimal(value(options, "--max-fee-sol"), 9);
            return { request: { command: "policy.admit-solana", profile: value(options, "--profile"), asset,
                    maximumPerTransfer: value(options, "--max-per-transfer"), dailyLimit: value(options, "--daily-limit"), maximumFee: value(options, "--max-fee-sol") } };
        }
        case "pay transfer prepare-solana": {
            const asset = solanaAsset(options);
            chainDecimal(value(options, "--amount"), asset === "sol" ? 9 : 6);
            chainDecimal(value(options, "--max-fee-sol"), 9);
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
        case "wallet metamask native-transfer": return { request: { command: "wallet.metamask.native-transfer", profile: value(options, "--profile"), chainId: metaMaskNativeChain(value(options, "--chain")), recipient: value(options, "--recipient"), amountAtomic: value(options, "--amount-atomic"), idempotencyKey: value(options, "--idempotency-key") } };
        case "wallet metamask native-transfer-status": return { request: { command: "wallet.metamask.native-transfer-status", operationId: value(options, "--operation") } };
        case "wallet metamask native-transfer-observe": return { request: { command: "wallet.metamask.native-transfer-observe", operationId: value(options, "--operation") } };
        case "wallet status": return { request: { command: "wallet.status", profile: value(options, "--profile") } };
        case "wallet balance": {
            // One asset is selected by --chain and --asset together; neither keeps the Base ETH and USDC read.
            if ((options["--chain"] === undefined) !== (options["--asset"] === undefined) ||
                (options["--chain"] === undefined && options["--decimals"] !== undefined)) {
                throw new ApnError("APN_INVALID_INPUT", "Select one asset with both --chain and --asset, or omit --chain, --asset and --decimals for Base ETH and USDC.");
            }
            return {
                request: { command: "wallet.balance", profile: value(options, "--profile"), ...(options["--chain"] === undefined ? {} : { asset: bindAsset(options) }) },
                rpcUrl: value(options, "--rpc-url"),
            };
        }
        case "wallet portfolio": return { request: { command: "wallet.portfolio", profile: value(options, "--profile"), ...(value(options, "--refresh") === "true" ? { refresh: true } : {}) } };
        case "wallet policy show": return { request: { command: "wallet.policy.show", profile: value(options, "--profile"), ...bindNetwork(options) } };
        case "wallet policy set": return {
            request: {
                command: "wallet.policy.set",
                ...bindNetwork(options),
                profile: value(options, "--profile"),
                maxBalanceUsdcAtomic: value(options, "--max-balance-usdc-atomic"),
                maxX402AmountAtomic: value(options, "--max-x402-amount-atomic"),
                ...(options["--max-balance-eth-wei"] === undefined ? {} : { maxBalanceEthWei: options["--max-balance-eth-wei"] }),
                ...(options["--x402-payees"] === undefined ? {} : { x402Payees: options["--x402-payees"] === X402_PAYEES_UNRESTRICTED ? null : options["--x402-payees"].split(",") }),
            },
        };
        case "x402 inspect": return { request: {
                command: "x402.inspect",
                url: value(options, "--url"),
                ...bindX402HttpRequest(options),
                ...bindNetwork(options),
                ...(options["--payer"] === undefined ? {} : { payer: options["--payer"] }),
            } };
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
                command: "transfer.prepare", profile: value(options, "--profile"), asset: bindListedAsset(options),
                recipient: value(options, "--to"), amount: value(options, "--amount"), maxFeeWei: value(options, "--max-fee-wei"),
                ...(options["--priority-fee-wei"] === undefined ? {} : { priorityFeeWei: value(options, "--priority-fee-wei") }),
                idempotencyKey: value(options, "--idempotency-key"),
            },
            rpcUrl: value(options, "--rpc-url"),
        };
        case "pay transfer approve": return {
            request: { command: "transfer.approve", operationId: value(options, "--operation") },
            ...(options["--rpc-url"] === undefined ? {} : { rpcUrl: options["--rpc-url"] }),
        };
        case "operation status": return { request: { command: "operation.status", operationId: value(options, "--operation"),
                ...(options["--refresh-allowance"] === "true" ? { refreshAllowance: true } : {}) } };
        case "operation abandon": return { request: { command: "operation.abandon", operationId: value(options, "--operation") } };
        case "operation resume": {
            if (options["--observe-only"] !== undefined && options["--observe-only"] !== "true") {
                throw new ApnError("APN_INVALID_INPUT", "--observe-only must be the literal true.");
            }
            if (options["--observe-only"] !== undefined && (options["--wait-seconds"] !== undefined || options["--observation-rpc-env"] !== undefined)) {
                throw new ApnError("APN_INVALID_INPUT", "--observe-only cannot be combined with --wait-seconds or --observation-rpc-env.");
            }
            const observationRpcEnv = options["--observation-rpc-env"] === undefined ? undefined
                : gaslessObservationRpcEnv(options["--observation-rpc-env"]);
            if (observationRpcEnv !== undefined && (options["--rpc-url"] !== undefined || options["--wait-seconds"] !== undefined)) {
                throw new ApnError("APN_INVALID_INPUT", "Observation RPC recovery cannot be combined with --rpc-url or --wait-seconds.", { reason: "gasless_observation_rpc_options" });
            }
            return {
                request: {
                    command: "operation.resume",
                    operationId: value(options, "--operation"),
                    ...(options["--wait-seconds"] === undefined ? {} : { waitSeconds: Number(options["--wait-seconds"]) }),
                    ...(observationRpcEnv === undefined ? {} : { observationRpcEnv }),
                    ...(options["--coinbase-observation-rpc"] === undefined ? {} : { coinbaseObservationRpc: coinbaseObservationPreset(options["--coinbase-observation-rpc"]) }),
                    ...(options["--observe-only"] === undefined ? {} : { observeOnly: true }),
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
function bindRelayCommand(path, options) {
    if (path === "relay prepare")
        return { request: bindRelayPrepare(options) };
    const target = { profile: value(options, "--profile"), operationId: value(options, "--operation") };
    if (path === "relay retire" || path === "relay status")
        return { request: { command: path === "relay retire" ? "relay.retire" : "relay.status", ...target } };
    return { request: { command: "relay.route", action: path === "relay execute" ? "execute" : "observe", ...target }, rpcUrl: value(options, "--rpc-url"),
        ...(options["--destination-rpc-url"] === undefined ? {} : { destinationRpcUrl: options["--destination-rpc-url"] }) };
}
function solanaAsset(options) {
    const asset = value(options, "--asset");
    if (asset !== "sol" && asset !== "usdc" && asset !== "usdt")
        throw new ApnError("APN_INVALID_INPUT", "Select the explicit sol, usdc or usdt asset alias.");
    return asset;
}
function tronAsset(options) {
    const asset = value(options, "--asset");
    if (asset !== "trx" && asset !== "usdt")
        throw new ApnError("APN_INVALID_INPUT", "Select the explicit trx or usdt asset alias.");
    return asset;
}
/** The x402 network and token a command names: `--chain` is any eip155 chain, `--asset` an exact ERC-20 contract. */
function bindNetwork(options) {
    // Solana x402 (`--chain solana:5eykt4…`) names its SPL mint and has neither an ETH cap nor an EVM payee pin.
    if (options["--chain"] === X402_SOLANA_POLICY_NETWORK) {
        if (options["--asset"] === undefined || !solanaAccount(options["--asset"])) {
            throw new ApnError("APN_INVALID_INPUT", "A Solana x402 policy names its mint with --asset <canonical mint address>.");
        }
        if (options["--max-balance-eth-wei"] !== undefined || options["--x402-payees"] !== undefined) {
            throw new ApnError("APN_INVALID_INPUT", "A Solana x402 policy takes no --max-balance-eth-wei or --x402-payees; its payee pin is the allowlist x402 row's recipients.");
        }
        return { solanaMint: options["--asset"] };
    }
    return {
        ...(options["--chain"] === undefined ? {} : { chainId: x402Chain(options["--chain"]) }),
        ...(options["--asset"] === undefined ? {} : { asset: x402Token(options["--asset"]) }),
    };
}
/** An x402 token is an exact ERC-20 contract, never the native coin. */
function x402Token(value) {
    const token = evmToken(value);
    if (token === "native")
        throw new ApnError("APN_INVALID_INPUT", "The x402 --asset is an exact ERC-20 contract address.");
    return token;
}
function bindAsset(options) {
    const decimals = bindDecimals(options);
    return {
        chainId: directEvmChain(value(options, "--chain")), token: evmToken(value(options, "--asset")),
        ...(decimals === undefined ? {} : { decimals }),
    };
}
function bindDecimals(options) {
    const decimals = options["--decimals"];
    if (decimals !== undefined && !/^(?:0|[1-9][0-9]{0,2})$/u.test(decimals))
        throw new ApnError("APN_INVALID_INPUT", "Asset decimals must be a canonical integer from 0 through 255.");
    return decimals === undefined ? undefined : evmDecimals(Number(decimals));
}
/** Direct transfers bind only frozen-list networks and pinned contracts; balance reads keep the open selector. */
function bindListedAsset(options) {
    return listedEvmAsset(value(options, "--chain"), value(options, "--asset"), bindDecimals(options)).selection;
}
function value(options, name) {
    const selected = options[name];
    if (selected === undefined)
        throw new ApnError("APN_INTERNAL", "The command catalog omitted a required request binding.");
    return selected;
}
/** Public names of the MetaMask native transfer networks; journals and quotes retain numeric IDs. */
function metaMaskNativeChain(name) {
    switch (name) {
        case "ethereum": return 1;
        case "optimism": return 10;
        case "monad": return 143;
        case "linea": return 59144;
        case "sei": return 1329;
        default: throw new ApnError("APN_INVALID_INPUT", "MetaMask native transfers run on ethereum, optimism, monad, linea and sei only.");
    }
}
//# sourceMappingURL=command-binder.js.map