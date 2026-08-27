export interface PinnedAddress {
    readonly address: string;
    readonly family: 4 | 6;
}
type NetworkConfigCode = "APN_RPC_CONFIG" | "APN_HTTP_CONFIG";
export declare function parsePublicHttpsUrl(value: string, code: NetworkConfigCode, label: string, maxUrlBytes?: number): URL;
export declare function resolvePublicAddresses(endpoint: URL, code: NetworkConfigCode, label: string): Promise<readonly PinnedAddress[]>;
export declare function isPublicIp(address: string): boolean;
export declare function sameIpAddress(left: string, right: string): boolean;
export declare function unbracket(host: string): string;
export {};
