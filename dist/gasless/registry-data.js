// Exact 2026-09-08/09 public source/runtime pins; revalidated before every effect.
// Source seed SHA256 b05aca1551fafb5734cccc0fe2b51d493782471544d03e63ae267c4b58104972.
// Per-chain rows carry a token list. Every identity below is asserted against the chain at action time by
// `verifyProtocolAt`; `symbol` is display-only and `balanceLayout` is a claim about one implementation's storage that
// the mirror estimate proves against the chain before it is used.
export const GASLESS_REGISTRY_DATA = [
    {
        "chainId": 1,
        "network": "ETHEREUM",
        "label": "Ethereum",
        "entryPointHash": "0x44e632a24c6f2600cbd5b5b8b4c2d372359112c8b5774297f5fd0a9e64f11f86",
        "delegateHash": "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3",
        "publicBundlerUrl": "https://public.pimlico.io/v2/1/rpc",
        "tokens": [
            {
                "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                "name": "USD Coin",
                "symbol": "USDC",
                "decimals": 6,
                "permitDomainVersion": "2",
                "domainSeparator": "0x06c37168a7db5138defc7866392bb87a741f9b3d104deb5094588ce041cae335",
                "proxyHash": "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505",
                "implementationSlot": "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
                "implementation": "0x43506849d7c04f9138d1a2050bbf3a0c054402dd",
                "implementationHash": "0xcdfb7d322961af3acae7a8f7ee8b69c205b36f576cc5b077f170c7eb8ecbe3ea",
                "signatureChecker": "0x800c32eaa2a6c93cf4cb51794450ed77fbfbb172",
                "signatureCheckerHash": "0x76cfc2ce63b1f05cb58ae553090665c2aabf2e13cf8a0e6da755c096fc5295dd",
                "balanceLayout": {
                    "implementationHash": "0xcdfb7d322961af3acae7a8f7ee8b69c205b36f576cc5b077f170c7eb8ecbe3ea",
                    "mappingSlotAtomic": "9"
                },
                "paymaster": {
                    "address": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
                    "proxyHash": "0x6ed62b6e72af8fab750c07bebbe4de671b2d3c31f273cd2acefc0fa568f78a6a",
                    "implementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
                    "implementation": "0xdc57d57552256df09ffebed067baa06ee49415f1",
                    "implementationHash": "0x78ea3099f0f4737782225ecae40e74a2bf60d645b0b54bcc51bf948c39790412",
                    "wrappedNativeToken": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
                }
            }
        ]
    },
    {
        "chainId": 10,
        "network": "OPTIMISM",
        "label": "Optimism",
        "entryPointHash": "0x49ff5c033c81f4ebe0467c1127c9a6c6f3ad1837405c199bea9b494fee621c04",
        "delegateHash": "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3",
        "publicBundlerUrl": "https://public.pimlico.io/v2/10/rpc",
        "tokens": [
            {
                "address": "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
                "name": "USD Coin",
                "symbol": "USDC",
                "decimals": 6,
                "permitDomainVersion": "2",
                "domainSeparator": "0x26d9c34bb1a1c312f69c53b2d93b8be20faafba63af2438c6811713c9b1f933f",
                "proxyHash": "0xaad43333d28e146557f1c682e8a4226743fb231fdd00a577512233bd9e920008",
                "implementationSlot": "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
                "implementation": "0xded3b9a8dbedc2f9cb725b55d0e686a81e6d06dc",
                "implementationHash": "0x24c6e8b8e0aaea31861e014c15e9da1564402d3512eb474d46def8e8bb2b2259",
                "signatureChecker": "0x5042f2376Cb78B4F68B6Ab13792f88d3D4cFa101",
                "signatureCheckerHash": "0xed6daa87f578492a862dee44722f8d6f329fbfc6f96e1737bd8a59781a514d1c",
                "balanceLayout": {
                    "implementationHash": "0x24c6e8b8e0aaea31861e014c15e9da1564402d3512eb474d46def8e8bb2b2259",
                    "mappingSlotAtomic": "9"
                },
                "paymaster": {
                    "address": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
                    "proxyHash": "0x6ed62b6e72af8fab750c07bebbe4de671b2d3c31f273cd2acefc0fa568f78a6a",
                    "implementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
                    "implementation": "0x3e89923c2a6f9c01e2cf09900003e7cbda751c77",
                    "implementationHash": "0x2b35c9c7ab9bbbbd989b84382a93ddab1e1b19de17a30671812af9f7e90f09e0",
                    "wrappedNativeToken": "0x4200000000000000000000000000000000000006"
                }
            }
        ]
    },
    {
        "chainId": 130,
        "network": "UNICHAIN",
        "label": "Unichain",
        "entryPointHash": "0xc5a2830ef7a65c77f814adc31d337536cb88a8a38f901cd6d84254dce666aa8e",
        "delegateHash": "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3",
        "publicBundlerUrl": "https://public.pimlico.io/v2/130/rpc",
        "tokens": [
            {
                "address": "0x078d782b760474a361dda0af3839290b0ef57ad6",
                "name": "USDC",
                "symbol": "USDC",
                "decimals": 6,
                "permitDomainVersion": "2",
                "domainSeparator": "0x565b4c4095d739dada6adeb9a89bc6dc4d102500ebd4a88bef1ec1d0f69d83b8",
                "proxyHash": "0xc2059a483ceeca165dfcc9727922e7c8c7b99710e84eca06cf765c235b133893",
                "implementationSlot": "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
                "implementation": "0xbe959c573dc03a18a57e31c9ace210ccf66f0f6e",
                "implementationHash": "0xe684ffbde87d9e39eab41738ffd638eb3a00f86c365892a640488ca6a2cff4b7",
                "signatureChecker": "0xD254915fc567865730F0516f8933bC0b96ec3527",
                "signatureCheckerHash": "0x4e6dd21b4f2b8a82fea448cdfe7a4f6f6a033c542b7402774cc3634182818357",
                "balanceLayout": {
                    "implementationHash": "0xe684ffbde87d9e39eab41738ffd638eb3a00f86c365892a640488ca6a2cff4b7",
                    "mappingSlotAtomic": "9"
                },
                "paymaster": {
                    "address": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
                    "proxyHash": "0x6ed62b6e72af8fab750c07bebbe4de671b2d3c31f273cd2acefc0fa568f78a6a",
                    "implementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
                    "implementation": "0xcd9904a024f99a7075dbb1a9e96066970b0e700d",
                    "implementationHash": "0x0d66e17b4b1bde063ddb7f3647b0d58b8025832fa816aa8e4e09180af6dda290",
                    "wrappedNativeToken": "0x4200000000000000000000000000000000000006"
                }
            }
        ]
    },
    {
        "chainId": 137,
        "network": "POLYGON",
        "label": "Polygon PoS",
        "entryPointHash": "0x9b02bddddb9413003580adbd2343b5c0338451e96810228aa8a6903d352169cb",
        "delegateHash": "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3",
        "publicBundlerUrl": "https://public.pimlico.io/v2/137/rpc",
        "tokens": [
            {
                "address": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
                "name": "USD Coin",
                "symbol": "USDC",
                "decimals": 6,
                "permitDomainVersion": "2",
                "domainSeparator": "0xcaa2ce1a5703ccbe253a34eb3166df60a705c561b44b192061e28f2a985be2ca",
                "proxyHash": "0x7dbf0ee7d6d69b563891ceb7056cf0ff0fa09d21a48e5f812d89981c2ef95944",
                "implementationSlot": "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
                "implementation": "0x235ae97b28466db30469b89a9fe4cff0659f82cb",
                "implementationHash": "0x39ec98a4509fb2d4380a9cd4623e7b20cf651cb58edb8d8332bfad9c3d698143",
                "signatureChecker": "0x03Da5A1AE03B5F60B162A098c617c13b4dC2dA69",
                "signatureCheckerHash": "0xa68cc5470c7ec2ad122e21b9559d936cbbbf0e61cbd7c8bb37d63d4d89704d82",
                "balanceLayout": {
                    "implementationHash": "0x39ec98a4509fb2d4380a9cd4623e7b20cf651cb58edb8d8332bfad9c3d698143",
                    "mappingSlotAtomic": "9"
                },
                "paymaster": {
                    "address": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
                    "proxyHash": "0x6ed62b6e72af8fab750c07bebbe4de671b2d3c31f273cd2acefc0fa568f78a6a",
                    "implementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
                    "implementation": "0x3e89923c2a6f9c01e2cf09900003e7cbda751c77",
                    "implementationHash": "0xdcb7b423c265f8a7620db8f4f439cd68f26d11425fb984eeecc8bcac923938ae",
                    "wrappedNativeToken": "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"
                }
            }
        ]
    },
    {
        "chainId": 8453,
        "network": "BASE",
        "label": "Base",
        "entryPointHash": "0x28f989233f4ffb52e4b168fb74df5dfa52fe0f846141774f5abc56c5604d8e46",
        "delegateHash": "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3",
        "publicBundlerUrl": "https://public.pimlico.io/v2/8453/rpc",
        "tokens": [
            {
                "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "name": "USD Coin",
                "symbol": "USDC",
                "decimals": 6,
                "permitDomainVersion": "2",
                "domainSeparator": "0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f",
                "proxyHash": "0xa6705a10bb756b5dea144591118be77d7af0c3eee3bf2dfe2583dcb0364fefab",
                "implementationSlot": "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
                "implementation": "0x2ce6311ddae708829bc0784c967b7d77d19fd779",
                "implementationHash": "0x11b75a237997ab8328f65b2d5a55c10f0346d0a175741ed42ddf4f2c66b9e873",
                "signatureChecker": "0x2d943e25e1859ed786afe4afb2b42e14efac691e",
                "signatureCheckerHash": "0x150ffd179e8052572b1f2a18fa2f51c387038269a39d4284c83064aa1f41de3f",
                "balanceLayout": {
                    "implementationHash": "0x11b75a237997ab8328f65b2d5a55c10f0346d0a175741ed42ddf4f2c66b9e873",
                    "mappingSlotAtomic": "9"
                },
                "paymaster": {
                    "address": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
                    "proxyHash": "0x6ed62b6e72af8fab750c07bebbe4de671b2d3c31f273cd2acefc0fa568f78a6a",
                    "implementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
                    "implementation": "0x46d166896d9465a809a44a8e4d41a98ed7979772",
                    "implementationHash": "0x2300116fc80bb60d4008657f382ee585a811384be2150238f436bfa01492d2b5",
                    "wrappedNativeToken": "0x4200000000000000000000000000000000000006"
                }
            }
        ]
    },
    {
        "chainId": 42161,
        "network": "ARBITRUM",
        "label": "Arbitrum One",
        "entryPointHash": "0x49684f00c804420e129bac03ca503baa5312db5c36f68767d393bc36dd58c4c9",
        "delegateHash": "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3",
        "publicBundlerUrl": "https://public.pimlico.io/v2/42161/rpc",
        "tokens": [
            {
                "address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
                "name": "USD Coin",
                "symbol": "USDC",
                "decimals": 6,
                "permitDomainVersion": "2",
                "domainSeparator": "0x08d11903f8419e68b1b8721bcbe2e9fc68569122a77ef18c216f10b3b5112c78",
                "proxyHash": "0xad30d819dbc47814b7e6cb837fd7cc57fcb591479a38596ee93de4fc52e8c435",
                "implementationSlot": "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
                "implementation": "0x86e721b43d4ecfa71119dd38c0f938a75fdb57b3",
                "implementationHash": "0xda0578bf7fe0d04e320e166ab8f98061328fda8ae0a299882aeb38f1543c6a9d",
                "signatureChecker": "0x4e7d093ee4d74a01905cf5ca92eb0bf154a53247",
                "signatureCheckerHash": "0x8f1bc2aefd846961f2297a55c13224235d77012cdc903db15e26e8a1118f0533",
                "balanceLayout": {
                    "implementationHash": "0xda0578bf7fe0d04e320e166ab8f98061328fda8ae0a299882aeb38f1543c6a9d",
                    "mappingSlotAtomic": "9"
                },
                "paymaster": {
                    "address": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
                    "proxyHash": "0x6ed62b6e72af8fab750c07bebbe4de671b2d3c31f273cd2acefc0fa568f78a6a",
                    "implementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
                    "implementation": "0x415b13cb2a91541f637742c6a98484f424504226",
                    "implementationHash": "0x9817134243209798ffef8f4f7954895b88d3d9edf05262c66bb24c4fb8cd6bcc",
                    "wrappedNativeToken": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
                }
            }
        ]
    },
    {
        "chainId": 43114,
        "network": "AVALANCHE",
        "label": "Avalanche C-Chain",
        "entryPointHash": "0x0f5ede041dfb41e1efa08f44498305be0d26f50f0768927f51ff504908ad8c7d",
        "delegateHash": "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3",
        "publicBundlerUrl": "https://public.pimlico.io/v2/43114/rpc",
        "tokens": [
            {
                "address": "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
                "name": "USD Coin",
                "symbol": "USDC",
                "decimals": 6,
                "permitDomainVersion": "2",
                "domainSeparator": "0xbbea200329a938bc3438984a49cb0732e66d66d7bd59c127abacc1710e77f7b3",
                "proxyHash": "0x7140a935aa3bb55d334d6d325fea277e47674770b10823feefa6f8b2c58af5fc",
                "implementationSlot": "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
                "implementation": "0x30dfe0469803bce76f8f62ac24b18d33d3d6ffe6",
                "implementationHash": "0x4ff47fa5d29bc7c2d76a746ea8b176d9509b49dd16d974a186d94af41ecf6d62",
                "signatureChecker": "0x320F175a8C062505394b58B0b3d2C5292B2E5fD7",
                "signatureCheckerHash": "0xb73b5bc289915f5f6861af02c39f9f9ce623eb8b3ce0914c81f447cac4197282",
                "balanceLayout": {
                    "implementationHash": "0x4ff47fa5d29bc7c2d76a746ea8b176d9509b49dd16d974a186d94af41ecf6d62",
                    "mappingSlotAtomic": "9"
                },
                "paymaster": {
                    "address": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
                    "proxyHash": "0x6ed62b6e72af8fab750c07bebbe4de671b2d3c31f273cd2acefc0fa568f78a6a",
                    "implementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
                    "implementation": "0x73050b090faca03ac7d0ef3e33e99538c645888a",
                    "implementationHash": "0x62e3b5407fd9103a8a7c3300b6192dbd1580f5775afd4b5fcf4657687a0782cf",
                    "wrappedNativeToken": "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7"
                }
            }
        ]
    }
];
//# sourceMappingURL=registry-data.js.map