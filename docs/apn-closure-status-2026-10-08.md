# APN: проверка и остаток работ на 8 октября 2026

Проверки выполняются локально по решению Тони. Последний source producer: 930 тестов, 0 ошибок, 0 пропусков. Он проверяет текущие Solana/Jupiter/Orca изменения; новая публикация, установка и paid acceptance проверяются отдельно. Исторический счётчик 32 задач за 29 сентября сохраняется в [backlog](sprint-remaining-2026-09-23.md).

## Реальные операции

| Операция | Проверенный результат | Граница результата |
|---|---|---|
| MetaMask Base, C1-05 | APN `completed`, `rpc_safe_correlated`. Списано 0,08 USDC, получено 0,074899, комиссия 0,005101 USDC, нативное списание 0. Одна отправка. | Тони нажал окончательный Approve и 8 октября принял фактическую комиссию USDC. Одноразовое разрешение использовано, EIP-7702 designation сохраняется. Остальные сети отдельно. |
| Coinbase/AWAL Base, C1-06 | APN `completed`, `canonical_safe_coinbase_gasless_settlement`. Получено 0,001 USDC, комиссия USDC и нативное списание 0. Одна отправка. | Авторизованный агент прошёл foreground TTY. Использованы официальный установленный AWAL и локальный APN candidate; установка нового APN artifact отдельно. |
| Uniswap Ethereum USDC→USDT, C3-01/C3-08 | APN `observed`: debit 1000 atomic USDC, credit 999 atomic USDT, residual allowance 0. Approval и swap по одной отправке. | Канонический receipt и независимый public readback совпадают. Block 26142771, SAFE 26142793. Gas 0,000063388142209294 ETH; cap 0,0005 ETH. Cleanup не понадобился. |
| Jupiter SOL→USDC, C3-04 | Две прежние подписанные операции остаются `unknown_finality`. Новая операция 46 имеет подтверждённый RPC ответ `acknowledged` и состояние `submitted`, но finalized receipt пока отсутствует. | Public readback новой подписи в 05:49:14 UTC вернул отсутствующий status и прежние SOL/USDC balances. Ни одна подписанная операция не пересылается; usage не освобождается вручную. |

MetaMask operation `ce20b12e883e30a3cd3ffdd1a015043a3621681c154cc054e847c274fc026a5d`: [transaction](https://basescan.org/tx/0xe3a8ea58f856452552f70de2cc91cbfa1b2044c918d3a75b69dabce09763b579), block 52303872, SAFE 52303898.

Coinbase operation `5a1e686a23ecd6b96cdc7835e6291892950a20866ce23ff7b13181ed077e3c5a`: [transaction](https://basescan.org/tx/0x2abd5fa014435e4a747d24cb0abe7a1c1b450df50f49eae4934be24340d32ede), block 52304153, SAFE 52304197.

Uniswap operation `8f326179be01da74076184c901641fdd645696275828fb622e97640f23a473bb`: [approval](https://etherscan.io/tx/0xd80ff339623b9a2d313bc1c10801daa7102318d861f3e55c175a041e7114642f), [swap](https://etherscan.io/tx/0x63228743bf9d77b9a58df1ec6d82fd62734a9777d567076275704ec4cd2bdd55). Approval cap равен входу, 1000 atomic USDC; gas price cap 1,2 gwei. После marker используется только status.

Jupiter сохранённые операции:

- `67cec83fd91f78acb9decf9ef89dcf1f95c9551dcdf996d0a840db4c48cd8457`: signature `5CpyBQgZbRtVrMAMnAKf8H8xM1ChNMzbHELfQA14U33pQDNfwZ3g6k94NRrCBSMXsL2shfn3L9kWyPbvy73x6HkQ`, permanent claim записан 7 октября в 20:38:22 UTC. Исходный send ответ потерян. Marker, подпись и unknown lease сохранены.
- `ea25d97d0da057bfab9a6b6ade2b5799d8b81333ab99c33c793a75c0a8bde5ee`: signature `5sdGa18Jtau66J1H64YLD7mXqsjvMw3pztuMJuFcxnZjM2jP99pDFo3VXixH98zdfz77ppvX1no3M8iqMBFptih7`, marker записан 8 октября в 05:12:23 UTC, permanent claim отсутствует. Последний сохранённый fresh read оставлял 12 блоков; прежний catch не сохранил точную ошибку. Marked operation остаётся observe only.
- `ed04535cb343db8bd5b7871b8725492c395206ccfe339661d15817c2ead7a738`: signature `5GVVqQgp6BF4crDgYkKmnEX8JL3HhjT33eoHJPiNHNnLLpYFoaTnzy4y3vacxAfuGX9Jo1yhF1vTHyu6s3k3mSmj`, permanent claim `dca7d520f28f37fa6e2c9e2e784f5af4022802027a3287061d8c23accfd13e76`, RPC acknowledgement в 05:48:11 UTC. Input 1000000 lamports, minimum 114750 atomic USDC, slippage 50 bps, fee 6400 lamports, native cap 6000000. В 05:49:14 UTC finalized proof отсутствовал. Это одна новая подпись и одна отправка, а не paid acceptance.

На 05:22 UTC обе прежние подписи отсутствовали в public status/transaction, SOL был 44119287 lamports, USDC 379500 atomic, временный WSOL account отсутствовал. На 05:49:14 UTC те же balances сохранились. Отсутствие transaction не доказывает финальность и не разрешает release.

Истёкшие неподписанные попытки 40 и 44 дополнительно завершены штатным status как `failed_before_effect`, с освобождением lease и без marker. Попытка 45 отказала finite pool gate до quote/prepare/sign/send. Исторические пять более ранних неподписанных retirements сохраняются отдельно.

## MCP и установленный owner cap

Живой MCP stdio текущего локального candidate (APN 0.5.35, protocol 2025-06-18, 104 tools) прошёл Uniswap quote→prepare→status. Финансовые команды вернули точный foreground CLI handoff. Unsigned operation `222d534e98576bc82c4f01b7e91d8c8619c081e41ed47941aed31cdf756ccbac` после expiry завершилась `cleaned`, `zero_allowance_no_effect`: allowance и native debit 0, attempts отсутствуют.

Jupiter MCP теперь также прошёл свежие quote→prepare→status в попытках 44 и 46. MCP approve/execute вернули `APN_FOREGROUND_APPROVAL_REQUIRED` с точным CLI handoff. Попытка 44 остановилась в CLI simulation до marker; прежний общий error не позволяет восстановить конкретную причину. Попытка 46 после genuine TTY привела к одной подписанной отправке выше. Это проверка текущего локального candidate; новая установленная release сборка отдельно.

C3-07: установленный APN 0.5.35 с owner policy r27 `83299d5c428451f158e86f680982381a17222c61c51c8a1e775275981abcb1f8` отказал реальному USDC quote на 3000001 atomic при cap 3000000. Operation отсутствует; все 97 economic-state files сохранили hashes. Этот installed/current-owner cap-refusal proof завершён.

## Исходники и локальные проверки

Candidate содержит восстановление direct EVM, атомарное освобождение usage lease и MCP handoff. Jupiter поддерживает четыре отдельно выбранных finite Whirlpool lanes: 83, Esv, 4H и Fp. Fp использует отдельный mechanism digest, immutable pool/PDA/vault/fee checks и legacy ABI. Старые digests сохраняются; policy сама выбирает exact lane. Fp fixture помечен diagnostic/mixed-slot, моделируемые simulation/receipt vectors помечены SYNTHETIC. Pool 9Vu не допущен, Quantum V2 не подписывается.

Перед quote freeze Jupiter получает confirmed blockhash настроенного mainnet RPC после полного чтения executable. Исходный официальный build сохраняется; hash-bound `quoteRpcLifetime` связывает RPC origin/context/lifetime с окончательным message. После freeze blockhash/message не заменяются. Quote требует запас 100–151 блоков; перед marker/sign нужен запас не меньше 24 блоков. TTL 90 секунд, финансовые caps и постоянный first-send fence сохранены.

Полные ProgramData Token/JUP6/Whirlpool читаются перед каждым финансовым эффектом. Первый chunk одновременно содержит loader header и payload; chunks ограничены 1500000 bytes, metadata/space/length/context и полные payload hashes проверяются. Свежая публичная проверка в 05:40:30 UTC прочитала все bytes за 9865 ms: 14 physical POST и 16 logical reads вместо прежних 22/24. Message и runtime pins совпали. Это unsigned read benchmark, а не финансовый proof.

Все logical calls, physical POST, pacing и durable cooldown учитываются. Gzip wire/decoded body ограничены 2 MiB. На публичном mainnet endpoint account methods используют отдельные последовательные POST после ранее доказанного batch method-limit refusal. Пейсинг допускает одну дополнительную задержку, если timer проснулся раньше и clock продвинулся; stuck/backward clock и повторный early wake отказывают до POST. Legacy quote discovery допускает один unfiltered read после selected finite-route refusal; decoder, caps и route gate сохраняются.

Create-only `data.dispatchObservation` связывает RPC результат с claim/marker/binding/signature. `data.executionFailure` сохраняет отказ binding/sign или pre-claim sender проверки, привязанный к marker. Simulation ошибки дают только fixed reason category и ограниченные числовые instruction codes. Provider text, logs, keys и signed payload не входят в diagnosis. Эти records не разрешают resend/release; старые ошибки не восстанавливаются.

| Producer | Результат и область |
|---|---|
| Последний Solana/Jupiter/Orca producer | 930 pass, 0 fail, 0 skip; 300557 ms; 32 test files. Все 1228 source/test/script/config inputs неизменны. |
| Последний focused public-read/simulation-failure producer | 22 pass, 0 fail, 0 skip. Short/stale/changed chunk refusal и finite sanitized failure categories. |
| Production/test emission parity | Все 744 production JS совпадают с проверенной сборкой после удаления только точного terminal TypeScript source-map comment. Другие bytes не исключались. |
| Source/test compile и core boundary | Обе сборки exit 0; scan 744 source files и limit 500 строк прошли. |
| Shipped runtime dependency boundary | 3 pass, 0 fail, 0 skip. |
| Предыдущие producers | 914/31 files, 703/24 files, 663 и 3989 full-core pass относятся к прежним source snapshots; их результаты сохранены отдельно и не складываются с 930. |

Начальные неуспешные compile/test/parity попытки сохранены. В частности, неполный reserve producer был остановлен после compile failure и изменения inputs; он не считается QA. Финальная parity проверка исключает ровно compiler comment, без предположения о завершающем newline. Свежая проверка после 930-test producer повторно подтвердила hashes всех 1228 inputs и 744 production JS.

## Что остаётся

| Задача | Остаток |
|---|---|
| C1-02, local Ethereum gasless USDC | Реальная доставка в исходном gross/fee cap. Ранние quote превышали лимиты; свежего bounded delivery proof нет. MetaMask waiver не изменяет этот cap. |
| C1-04, MetaMask 8 сетей | Семь дополнительных network receipts и новая installed APN acceptance. |
| C1-06, Coinbase install acceptance | Paid Base provider proof готов; новый APN artifact/install отдельно. |
| C1-09, LI.FI | Ethereum→Base canonical USDC и исходные дополнительные asset obligations. Завершённые направления не пересылаются. |
| C1-11, nativefree dependency closure | Runtime mitigation действует. Portable alias candidate не принят: consumer root collision разрешил исходный bigint-buffer; pre-import gate остановил его исполнение. Нужны исправленная упаковка и свежий real-consumer proof. |
| C2-08, Sei | Последний funding read 7 октября 19:57 UTC: три profiles по 0 SEI. Admitted funding route и direct receipt отсутствуют. |
| C2-10, non-USDC x402 | Ранее принят Ethereum USDT owned-seller payment; внешний x402 merchant result ещё не доказан. |
| C3-01/C3-08, Uniswap token input | Bounded SAFE paid proof завершён; новая release/install acceptance отдельно. |
| C3-04, Jupiter | Finalized SOL→USDC receipt и штатное usage charge. Две unknown операции и новая submitted операция наблюдаются без resend/release. |
| C3-09, MCP swap | Local-candidate Uniswap и Jupiter quote→prepare→status доказаны, Uniswap paid proof готов. Jupiter paid proof и новый installed release отдельно. |
| Release/distribution | Новая npm/Homebrew публикация и установка отсутствуют; CI runners Тони исключил из текущих условий. |

Принятые Monad native, Ethereum USDT, Stargate и terminal LI.FI операции не повторяются. External Avalanche merchant search снят Тони с очереди; исторический acceptance не переводится в PASS.
