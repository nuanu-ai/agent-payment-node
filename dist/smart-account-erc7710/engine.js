import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client } from "@metamask/x402";
import { privateKeyToAccount } from "viem/accounts";
import { smartAccountEnvironment } from "../metamask-smart-account-grant.js";
/** Uses the pinned MetaMask SDK to create and sign exactly one child delegation. */
export class OfficialErc7710Engine {
    async create(intent, custody) {
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
            payload: created.payload,
        };
    }
}
//# sourceMappingURL=engine.js.map