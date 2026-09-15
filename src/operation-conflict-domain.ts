import { SOLANA_GENESIS } from "./chain-policy.js";
import type { StoredMoneyOperation } from "./operation-service.js";
import { TRON_GENESIS } from "./tron/constants.js";

/** Two money operations conflict only when they can race for one account on one network. */
export interface MoneyConflictDomain {
  readonly family: "evm" | "solana" | "tron";
  readonly network: string;
  readonly account: string;
}

export function evmConflictDomain(chainId: number | string, account: string): MoneyConflictDomain {
  const network = String(chainId);
  if (!/^[1-9][0-9]{0,15}$/u.test(network) || !/^0x[0-9a-fA-F]{40}$/u.test(account)) throw new Error("Invalid EVM conflict domain.");
  return { family: "evm", network, account: account.toLowerCase() };
}

export function railConflictDomain(rail: "solana" | "tron", account: string): MoneyConflictDomain {
  if ((rail !== "solana" && rail !== "tron") || !/^[A-Za-z0-9]{32,64}$/u.test(account)) throw new Error("Invalid rail conflict domain.");
  return { family: rail, network: rail === "solana" ? SOLANA_GENESIS : TRON_GENESIS, account };
}

export function conflictDomainKey(domain: MoneyConflictDomain): string {
  return `${domain.family}:${domain.network}:${domain.account}`;
}

/** Null marks a record whose network or account cannot be read; the caller then blocks the whole profile. */
export function storedOperationDomains(operation: StoredMoneyOperation): readonly MoneyConflictDomain[] | null {
  try {
    if (operation.kind === "direct_transfer") return [evmConflictDomain(operation.record.chainId, operation.record.walletAddress)];
    if (operation.kind === "x402_fetch") {
      // Provider-atomic x402 is Base-only; its record carries the network as CAIP-2 instead of a chain id.
      return [operation.strategy === "local" ? evmConflictDomain(operation.record.chainId, operation.record.wallet)
        : evmConflictDomain(8453, operation.record.provider.payer)];
    }
    if (operation.kind === "rail_transfer") return [railConflictDomain(operation.record.account.rail, operation.record.account.address)];
    if (operation.kind === "bridge_route") {
      return [evmConflictDomain(operation.record.intent.sourceDeployment.chainId, operation.record.intent.owner.address)];
    }
    if (operation.kind === "gasless_transfer") {
      return [evmConflictDomain(operation.record.intent.request.chainId, operation.record.intent.owner.address)];
    }
    if (operation.kind === "metamask_gasless_transfer") {
      return [evmConflictDomain(operation.record.intent.request.chainId, operation.record.intent.binding.address)];
    }
    return [evmConflictDomain(operation.record.intent.request.chainId, operation.record.intent.binding.ownerAddress)];
  } catch {
    return null;
  }
}
