import { BASE_USDC, CHAIN_CAIP2, ETH_DECIMALS, STATE_VERSION, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { formatAtomic } from "./money.js";
import { sealWallet } from "./state.js";
import { assertWalletMatches, canonicalProfile, parseWalletDescribe, parseWalletEnsure, publicProvenance, publicWallet, validateBalance, } from "./wallet-policy.js";
import { fundingPosture, policyBinding, publicProfilePolicy } from "./profile-policy.js";
import { projectLegacyLocalProfile } from "./provider-profile.js";
import { assertLocalNetworkProfile, networkPolicyBinding } from "./x402-network.js";
import { assertWalletLifecycleAvailable } from "./wallet-lifecycle-guard.js";
import { evmAddressLock } from "./evm-address-ownership.js";
export class WalletService {
    context;
    constructor(context) {
        this.context = context;
    }
    async doctorKeychain() {
        const profile = "default";
        const profileHash = this.context.state.profileHash(profile);
        const artifacts = await this.context.state.loadWalletArtifacts(profile, profileHash);
        if (artifacts.stored === null && artifacts.encrypted === null) {
            const wrapping = await this.context.requireKeychainProbe().load();
            wrapping?.fill(0);
            return { profile, status: "absent", proof_class: "encrypted_apn_home_status", next_actions: ["apn wallet ensure"] };
        }
        return await this.initializedStatus(profile, profileHash);
    }
    async ensure(profileInput) {
        const profile = canonicalProfile(profileInput);
        await this.context.ready();
        const profileHash = this.context.state.profileHash(profile);
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            await assertWalletLifecycleAvailable(this.context, profileHash);
            const providerProfile = await this.context.profileRepository?.load(profileHash) ?? null;
            if (providerProfile !== null && providerProfile.provider_id !== "local") {
                throw new ApnError("APN_PROFILE_DRIFT", "The APN profile is already bound to a different wallet provider.");
            }
            const stored = await this.context.state.loadWallet(profileHash);
            if (stored === null && await this.context.state.loadEncryptedWalletEnvelope(profile) !== null) {
                throw new ApnError("APN_PROFILE_DRIFT", "Encrypted wallet profile has incomplete public metadata; automatic repair is disabled.");
            }
            const native = this.context.requireNative();
            const result = stored === null
                ? parseWalletEnsure(await native.request(this.context.nativeRequest("wallet.ensure", { profile })), profile)
                : parseWalletDescribe(await native.request(this.context.nativeRequest("wallet.describe", { profile })), profile);
            if (!result.found) {
                throw new ApnError("APN_WALLET_MISMATCH", "Public wallet metadata exists but native key material is missing.");
            }
            if (stored !== null) {
                assertWalletMatches(stored, result);
                await this.materializeLocalProfile(stored, providerProfile);
                return publicWallet(stored, "ready");
            }
            const wallet = sealWallet({
                schemaVersion: STATE_VERSION,
                profile,
                profileHash,
                address: result.address,
                createdAt: result.createdAt,
                bindingHash: result.bindingHash,
            });
            await this.context.state.withLocks([evmAddressLock(wallet.address)], async () => {
                await this.context.state.writeWallet(wallet);
            });
            await this.materializeLocalProfile(wallet, providerProfile);
            return publicWallet(wallet, "ready");
        });
    }
    async importNew(profileInput, keyFile, keyName, expectedAddress) {
        const profile = canonicalProfile(profileInput);
        await this.context.ready();
        const profileHash = this.context.state.profileHash(profile);
        return await this.context.state.withLocks([`profile:${profileHash}`, "wallet-import-global", evmAddressLock(expectedAddress)], async () => {
            await assertWalletLifecycleAvailable(this.context, profileHash);
            const artifacts = await this.context.state.loadWalletArtifacts(profile, profileHash);
            const provider = await this.context.state.loadProviderProfile(profileHash);
            if (artifacts.stored !== null || artifacts.encrypted !== null || provider !== null) {
                throw new ApnError("APN_PROFILE_DRIFT", "Wallet profile is already occupied; import cannot overwrite it.");
            }
            const result = parseWalletEnsure(await this.context.requireNative().request(this.context.nativeRequest("wallet.import", { profile, keyFile, keyName, expectedAddress })), profile);
            if (!result.found)
                throw new ApnError("APN_NATIVE_PROTOCOL", "Native wallet import returned no identity.");
            const wallet = sealWallet({ schemaVersion: STATE_VERSION, profile, profileHash,
                address: result.address, createdAt: result.createdAt, bindingHash: result.bindingHash });
            await this.context.state.writeNewWallet(wallet);
            await this.context.state.writeNewProviderProfile(projectLegacyLocalProfile(wallet));
            return publicWallet(wallet, "ready");
        });
    }
    async materializeLocalProfile(wallet, existing) {
        const projected = projectLegacyLocalProfile(wallet);
        if (existing === null) {
            await this.context.profileRepository?.save(projected);
            return;
        }
        if (existing.provider_id !== "local" || existing.public_address.toLowerCase() !== wallet.address.toLowerCase() ||
            existing.account_binding_hash !== wallet.bindingHash || existing.capability_hash !== projected.capability_hash) {
            throw new ApnError("APN_STATE_CORRUPT", "Local provider profile projection does not match legacy wallet state.");
        }
    }
    async status(profileInput) {
        const profile = canonicalProfile(profileInput);
        const profileHash = this.context.state.profileHash(profile);
        const artifacts = await this.context.state.loadWalletArtifacts(profile, profileHash);
        if (artifacts.stored === null && artifacts.encrypted === null) {
            return { profile, status: "absent", proof_class: "encrypted_apn_home_status", next_actions: ["apn wallet ensure"] };
        }
        return await this.initializedStatus(profile, profileHash);
    }
    async initializedStatus(profile, profileHash) {
        await this.context.ready();
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            const stored = await this.context.state.loadWallet(profileHash);
            const result = parseWalletDescribe(await this.context.requireNative().request(this.context.nativeRequest("wallet.describe", { profile })), profile);
            if (stored === null) {
                if (!result.found) {
                    return { profile, status: "absent", proof_class: "encrypted_apn_home_status", next_actions: ["apn wallet ensure"] };
                }
                return {
                    profile,
                    status: "encrypted_home_only",
                    address: result.address,
                    bindingHash: result.bindingHash,
                    proof_class: "encrypted_apn_home_status",
                    next_actions: [],
                };
            }
            if (!result.found)
                throw new ApnError("APN_WALLET_MISMATCH", "Native key material is missing for public wallet metadata.");
            assertWalletMatches(stored, result);
            return publicWallet(stored, "ready");
        });
    }
    async balance(profileInput) {
        const profile = canonicalProfile(profileInput);
        await this.context.ready();
        const profileHash = this.context.state.profileHash(profile);
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            const wallet = await this.context.state.loadWallet(profileHash);
            if (wallet === null)
                throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
            const policy = await this.context.requirePolicy().load(policyBinding(wallet));
            const snapshot = await this.context.requireRpc().getBalances(wallet.address);
            validateBalance(snapshot, wallet.address);
            return {
                profile,
                funding_address: wallet.address,
                explorer_url: `https://basescan.org/address/${wallet.address}`,
                chain: CHAIN_CAIP2,
                proof_class: "chain_verified_public_read",
                balances: {
                    ETH: { atomic: snapshot.ethAtomic, decimal: formatAtomic(snapshot.ethAtomic, ETH_DECIMALS), decimals: ETH_DECIMALS },
                    USDC: {
                        atomic: snapshot.usdcAtomic,
                        decimal: formatAtomic(snapshot.usdcAtomic, USDC_DECIMALS),
                        decimals: USDC_DECIMALS,
                        contract: BASE_USDC,
                    },
                },
                provenance: publicProvenance(snapshot),
                funding_guidance: {
                    action: "Fund this disposable wallet manually with a small amount of Base ETH for gas and Base USDC for the payment.",
                    warning: "Only fund an amount you can afford to lose; this local-software wallet has no backup or hardware protection.",
                },
                funding_posture: fundingPosture(snapshot.usdcAtomic, snapshot.ethAtomic, policy),
                next_actions: ["Fund with low value only", "Re-run apn wallet balance"],
            };
        });
    }
    async policyShow(profileInput, chainId) {
        const profile = canonicalProfile(profileInput);
        await this.context.ready();
        const profileHash = this.context.state.profileHash(profile);
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            await assertLocalNetworkProfile(this.context, profile, chainId);
            const binding = networkPolicyBinding(await this.policyBindingForProfile(profileHash), chainId);
            return publicProfilePolicy(profile, await this.context.requirePolicy().load(binding), chainId);
        });
    }
    async policySet(request) {
        const profile = canonicalProfile(request.profile);
        await this.context.ready();
        const profileHash = this.context.state.profileHash(profile);
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            await assertLocalNetworkProfile(this.context, profile, request.chainId);
            const binding = networkPolicyBinding(await this.policyBindingForProfile(profileHash), request.chainId);
            const policy = await this.context.requirePolicy().set(binding, {
                maxBalanceUsdcAtomic: request.maxBalanceUsdcAtomic,
                maxX402AmountAtomic: request.maxX402AmountAtomic,
                ...(request.maxBalanceEthWei === undefined ? {} : { maxBalanceEthWei: request.maxBalanceEthWei }),
            });
            return publicProfilePolicy(profile, policy, request.chainId);
        });
    }
    async policyBindingForProfile(profileHash) {
        const provider = await this.context.profileRepository?.load(profileHash) ?? null;
        if (provider !== null)
            return policyBinding(provider);
        const wallet = await this.context.state.loadWallet(profileHash);
        if (wallet === null)
            throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
        return policyBinding(wallet);
    }
}
//# sourceMappingURL=wallet-service.js.map