import type { AllowlistPolicyFile } from "../../src/allowlist-policy-v2.js";
import { oneClickMechanism } from "../../src/lifi/near-oneclick-admission.js";
import { oneClickLane } from "../../src/lifi/near-oneclick-lanes.js";
import type { Address } from "../../src/model.js";
import { activateDirectPolicy, WIDE_CAPS } from "./direct-allowlist-helpers.js";

type Admission = AllowlistPolicyFile["admissions"][number];
export interface OneClickPolicyLane { readonly lane: string; readonly maximumPerTransferAtomic?: string; readonly recipients?: readonly string[] }

/**
 * Activates one owner revision admitting these 1Click lanes on the payer's origin assets: the `bridge` rail with one
 * mechanism per lane (a single pin, or alternatives when several lanes share Ethereum ETH) and one daily limit per asset.
 */
export async function activateOneClickPolicy(root: string, payer: Address, lanes: readonly OneClickPolicyLane[],
  dailyLimitAtomic: string = WIDE_CAPS.dailyLimitAtomic, profile = "imported"): Promise<void> {
  const groups = new Map<string, OneClickPolicyLane[]>();
  for (const entry of lanes) {
    const origin = oneClickLane(entry.lane).origin, key = `${origin.chainId}:${origin.token ?? "native"}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const admissions = [...groups.values()].map((entries): Admission => {
    const origin = oneClickLane(entries[0]!.lane).origin;
    const asset = origin.token === null ? { kind: "native" as const } : { kind: "token" as const, identifier: origin.token };
    const pin = (entry: OneClickPolicyLane) => ({ ...oneClickMechanism(oneClickLane(entry.lane)),
      maximumPerTransferAtomic: entry.maximumPerTransferAtomic ?? WIDE_CAPS.maximumPerTransferAtomic,
      ...(entry.recipients === undefined ? {} : { recipients: entry.recipients }) });
    if (entries.length > 1) return { chain: `eip155:${origin.chainId}`, ...asset, rail: "bridge", dailyLimitAtomic, mechanisms: entries.map(pin) } as Admission;
    const { maximumPerTransferAtomic, recipients, ...mechanism } = pin(entries[0]!);
    return { chain: `eip155:${origin.chainId}`, ...asset, rail: "bridge", maximumPerTransferAtomic, dailyLimitAtomic, mechanism,
      ...(recipients === undefined ? {} : { recipients }) } as Admission;
  });
  await activateDirectPolicy(root, profile, { accounts: { evm: payer }, admissions });
}
