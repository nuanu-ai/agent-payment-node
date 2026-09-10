import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client } from "@metamask/x402";
import { privateKeyToAccount } from "viem/accounts";
import { smartAccountEnvironment } from "../metamask-smart-account-grant.js";
import type { Erc7710Custody, Erc7710MaterialIntent, Erc7710PaymentPayload } from "./intent.js";

export interface Erc7710EnginePort {
  create(intent: Erc7710MaterialIntent, custody: Erc7710Custody): Promise<Erc7710PaymentPayload>;
}

/** Uses the pinned MetaMask SDK to create and sign exactly one child delegation. */
export class OfficialErc7710Engine implements Erc7710EnginePort {
  async create(intent: Erc7710MaterialIntent, custody: Erc7710Custody): Promise<Erc7710PaymentPayload> {
    const account = privateKeyToAccount(custody.sessionPrivateKey);
    const provider = createx402DelegationProvider({
      account,
      environment: smartAccountEnvironment(),
      from: intent.sessionAddress,
      salt: intent.salt,
      parentPermissionContext: custody.rootContext,
      caveats: [{ type: "timestamp", afterThreshold: intent.afterUnix, beforeThreshold: intent.beforeUnix }],
      redeemers: { requireRedeemers: true, addresses: [...intent.facilitatorAddresses] },
    });
    const created = await new x402Erc7710Client({ delegationProvider: provider })
      .createPaymentPayload(2, intent.requirements);
    return {
      x402Version: 2,
      accepted: intent.requirements,
      payload: created.payload as unknown as Erc7710PaymentPayload["payload"],
    };
  }
}
