/** Accounts named inside the Relay fixtures captured before 0.5.44. They are fixture data for "some profile's account"
 * and for operations written by earlier releases; production code no longer names any of them (OWNR-02/03/07). */
export const RELAY_BNB_SOURCE = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
export const RELAY_POLYGON_RECIPIENT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
export const RELAY_BNB_DEFAULT_SOURCE = RELAY_POLYGON_RECIPIENT;
export const RELAY_BASE_SOURCE = "0x991e254B5C8e0AAf6c244eaa2706BAd059809b04";
export const RELAY_BASE_ACCOUNT = RELAY_POLYGON_RECIPIENT;
export const RELAY_ETHEREUM_USDC_RECIPIENT = RELAY_BASE_SOURCE;
/** Amounts of the captured 2026-10-09 Base fixtures: caller inputs now, not route constants. */
export const RELAY_BASE_PRINCIPAL = 50_000_000_000_000n;
export const RELAY_BASE_FULL_FEE = 1_000_000_000_000n;
