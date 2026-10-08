# APN: проверка и остаток работ на 8 октября 2026

Проверки выполняются локально по решению Тони. Инвентарь CI runners больше не является условием этой работы. Новый CI run, релиз, npm/Homebrew установка и deployment этим результатом не подтверждаются. Исторический счётчик 32 задач за 29 сентября сохраняется в [backlog](sprint-remaining-2026-09-23.md); ниже записаны новые результаты, а не пересчитанный статус всего проекта.

## Реальные операции

| Операция | Проверенный результат | Граница результата |
|---|---|---|
| MetaMask Base, C1-05 | APN `completed`, `rpc_safe_correlated`. Списано 0,08 USDC, получено 0,074899, комиссия 0,005101 USDC. Нативное списание отправителя 0. Одна отправка. | Пользователь нажал окончательный Approve в браузере. Одноразовое разрешение использовано, EIP-7702 designation сохраняется. 8 октября Тони снял требование нулевой комиссии в USDC; этот Base результат принят с фактической комиссией. |
| Coinbase/AWAL Base, C1-06 | APN `completed`, `canonical_safe_coinbase_gasless_settlement`. Получено 0,001 USDC, комиссия USDC и нативное списание отправителя 0. Одна отправка. | Авторизованный агент прошёл foreground TTY; физическое нажатие человеком не подтверждается. Использован официальный установленный AWAL provider и локальный APN candidate. Новая APN release/install acceptance остаётся отдельной проверкой. |
| Uniswap Ethereum USDC→USDT, C3-01/C3-08 | APN `observed`: input debit 1000 atomic USDC, output credit 999 atomic USDT, residual allowance 0. Approval и swap по одной отправке. | Канонический receipt и независимое public readback совпадают. Block 26142771, SAFE 26142793. Gas 0,000063388142209294 ETH. Cleanup send не понадобился. Новая release/install acceptance отдельно. |
| Jupiter SOL→USDC, C3-04 | Пять истёкших неподписанных операций завершены `failed_before_effect`, usage lease освобождён. Новая операция имеет одну подпись и постоянный first-send claim, но остаётся `unknown_finality`: finalized receipt отсутствует. | В public readback на 7 октября 20:44 UTC signature status и transaction отсутствуют, SOL/USDC balances совпадают с исходными. Это не переводит journal в завершённое состояние. Операция не пересылается и lease не освобождается вручную. Quantum V2 остаётся отдельным неподписываемым историческим маршрутом. |

MetaMask operation: `ce20b12e883e30a3cd3ffdd1a015043a3621681c154cc054e847c274fc026a5d`, [transaction](https://basescan.org/tx/0xe3a8ea58f856452552f70de2cc91cbfa1b2044c918d3a75b69dabce09763b579), block 52303872, SAFE 52303898.

Coinbase operation: `5a1e686a23ecd6b96cdc7835e6291892950a20866ce23ff7b13181ed077e3c5a`, [transaction](https://basescan.org/tx/0x2abd5fa014435e4a747d24cb0abe7a1c1b450df50f49eae4934be24340d32ede), block 52304153, SAFE 52304197.

Uniswap operation: `8f326179be01da74076184c901641fdd645696275828fb622e97640f23a473bb`, [approval](https://etherscan.io/tx/0xd80ff339623b9a2d313bc1c10801daa7102318d861f3e55c175a041e7114642f), [swap](https://etherscan.io/tx/0x63228743bf9d77b9a58df1ec6d82fd62734a9777d567076275704ec4cd2bdd55). Approval cap равен входу: 1000 atomic (0,001 USDC). Максимум суммарного нативного списания 0,0005 ETH; цена газа ограничена 1,2 gwei. Повторный approval/execute для этой операции не нужен: после marker используется только status.

Jupiter operation: `67cec83fd91f78acb9decf9ef89dcf1f95c9551dcdf996d0a840db4c48cd8457`; сохранённая подпись `5CpyBQgZbRtVrMAMnAKf8H8xM1ChNMzbHELfQA14U33pQDNfwZ3g6k94NRrCBSMXsL2shfn3L9kWyPbvy73x6HkQ`. Input 1 000 000 lamports, API minimum 115542 atomic USDC, slippage 50 bps, native cap 6 000 000 lamports. Quote имел запас 143 блока после public reads. R1 simulation, полные executable rereads и Native signature прошли; claim записан в 20:38:22 UTC. Исходный ответ send RPC не сохранён, поэтому точная причина `unknown_finality` не установлена. Повторный send запрещён. Это не оплаченный acceptance.

Свежий production CLI status 8 октября в 03:43:40 UTC завершился успешно: `unknown_finality`, receiptProof отсутствует, usage lease `unknown_finality`, revision 6 и marker не изменены. Новая подпись или отправка не выполнялись.

Живой MCP stdio текущего локального candidate (`agent-payment-node` 0.5.35, protocol 2025-06-18, 104 tools) прошёл Uniswap USDC→USDT quote→prepare→status с profile `evm-live-buyer` и действующей policy `83299d5c428451f158e86f680982381a17222c61c51c8a1e775275981abcb1f8`. Quote `cab2b3eea7fcfec87d755988aa54e1c6d590539dc0bf88e3d659c986f3dee475`, operation `222d534e98576bc82c4f01b7e91d8c8619c081e41ed47941aed31cdf756ccbac`: при проверке `prepared`, approval/swap/cleanup attempts и usage reservation отсутствуют. Все три финансовых MCP команды вернули точный foreground CLI handoff. В 20:52:24 UTC status после expiry завершил эту unsigned операцию как `cleaned`, `zero_allowance_no_effect`: allowance 0, native debit 0, все attempts по-прежнему отсутствуют. Подтверждён текущий локальный MCP/provider path, новая установленная release сборка остаётся отдельной границей.

MCP Jupiter отказал запросу вне exact lane, а свежий допустимый запрос — маршруту вне выбранного finite pool/variant. Provider route gate сохранён. Первый MCP клиент передал slippage числом вместо требуемой schema строки и был исправлен; эта попытка не является acceptance.

Принятые ранее Monad native, Ethereum USDT и Stargate Ethereum→Base операции не повторялись. Исторические LI.FI Base→Arbitrum и Arbitrum→Ethereum USDC journals завершены; Ethereum→Base canonical USDC остаётся отдельным незакрытым направлением.

## Исходники и локальные проверки

В candidate включены проверенные исправления восстановления direct EVM, атомарного освобождения usage lease, MCP handoff и конечные Jupiter V1 Whirlpool lanes. Пины полных executable payload сохраняются; provenance обозначен `runtime_bytes_only`. Восстановление не получает новый signer, sender или произвольный доступ к Native.

Jupiter получает confirmed blockhash от настроенного mainnet RPC после объёмных публичных чтений и до фиксации quote. Исходный официальный build и его hash сохраняются без изменения; отдельное `quoteRpcLifetime` связывает RPC origin, context и lifetime с окончательным message. Quote требует запас 100–151 блоков. После фиксации quote замена blockhash или message запрещена: execution повторно собирает именно одобренный message, не запрашивая новый lifetime. TTL остаётся 90 секунд. Полные ProgramData payload Token/JUP6/Whirlpool проверяются перед финансовым эффектом; сокращения до одного header/hash доверенного провайдера нет.

Учитываются каждый logical read, physical POST и сохраняемый cooldown. Gzip допускается с независимыми лимитами 2 MiB на wire и decoded body. HTTP 429 проходит в существующий RPC/pacer механизм с `Retry-After`; ошибки не запускают автоматический повтор.

На `api.mainnet-beta.solana.com` два публичных batch account запроса вернули HTTP 429 с method limit 0, тогда как такой же одиночный account запрос вернул HTTP 200. Поэтому account reads на этом конкретном endpoint выполняются последовательными отдельными POST до первой ошибки. Бюджеты и pacing сохранены. Другие endpoints сохраняют bounded batch path.

Подсказка Jupiter `maxAccounts=12` в одном свежем запросе вернула FpCM, а официальный запрос без подсказки вернул проверенный 83v8. Legacy quote discovery теперь имеет максимум один повтор без подсказки, только при отказе finite route gate и до build/material freeze. Оба ответа проходят прежний строгий decoder и policy-selected pool gate. HTTP ошибки, malformed ответы и V2 policy не вызывают этот повтор. Новые пулы не добавлены.

| Producer | Результат и область |
|---|---|
| Frozen full-core producer | 3989 pass, 0 fail, 0 skip. Снимок до quote refresh/gzip/batching и последней RPC compatibility правки. |
| Gzip/freshness focused producer | 664 pass, 0 fail, 0 skip. Предшествует batching и последней compatibility правке. |
| Batching focused producer | 635 pass, 0 fail, 0 skip. Предшествует последней discovery/HTTP429/mainnet compatibility правке. |
| Mainnet compatibility producer | 654 pass, 0 fail, 0 skip; 169679 ms. Предшествует правке pre-freeze RPC lifetime. |
| Latest pre-freeze RPC lifetime producer | 663 pass, 0 fail, 0 skip; 169195 ms. Source/test snapshot: 1195 files; отдельное неизменённое compiled tree: 1118 files. |
| Genuine TEST-key Native и quote refresh | 38 pass, 0 fail, 0 skip. Official build blockhash и фиксируемый RPC blockhash различаются; подтверждены single-send, reopen без resend, expiry и policy revocation. |
| Shipped runtime dependency boundary | 3 pass, 0 fail, 0 skip на текущем dist. |
| Orca regression через общий Solana RPC | 130 pass, 0 fail, 0 skip; 42167 ms на том же compiled tree. |
| Generated dist parity | Все 741 source JS emission совпадают с проверенной test-сборкой. После удаления лишней пустой строки в конце test fixture выполнена финальная test compile: все 1118 compiled files побайтно совпадают с producer 663/130 тестов. Runtime sources не изменены. |
| Source и test compile | Последние обе сборки завершились с exit 0. |
| Core boundary | Scan 741 source files и Native limit 500 строк прошли. |

Первый новый discovery test run выявил отказ строгого decoder до builder fallback (11 pass / 4 fail). Fallback перенесён вокруг прежнего route refusal; decoder не ослаблен. Начальные ошибки TypeScript затронули только тип возвращаемого значения test resolver и исправлены. Эти попытки не считаются успешной QA. Первый полный compatibility прогон дал 649 pass / 5 fail: старый HTTP counter и четыре test budget fixtures. После исправления fixtures затронутые 192 теста и полный 654-test producer прошли; production pacing не ослаблен.

## Что остаётся

| Задача | Остаток |
|---|---|
| C1-02, local Ethereum gasless USDC | Реальная доставка в исходном fee/gross cap. Ранние quote превышали лимиты; свежая успешная bounded операция отсутствует. |
| C1-04, MetaMask 8 сетей | Семь дополнительных network receipts. Base результат выше не доказывает всю матрицу и новую установленную APN сборку. |
| C1-06, Coinbase install acceptance | Paid Base provider proof готов; установка нового APN artifact и её acceptance отдельно. |
| C1-09, LI.FI | Ethereum→Base canonical USDC и исходные дополнительные asset obligations. Завершённые старые направления не пересылаются. |
| C1-11, nativefree dependency closure | Runtime mitigation действует. Portable registry-alias candidate не принят: child overrides не управляют consumer root; collision install разрешил исходный bigint-buffer. Его исполнение остановлено до import/addon entry. Нужны исправленная упаковка и свежий consumer proof. |
| C2-08, Sei | На 7 октября 19:57 UTC три проверенных profile balances равны 0 SEI. Admitted funding route и прямой receipt отсутствуют. |
| C2-10, non-USDC x402 | Ethereum USDT owned-seller payment принят ранее. Реальный внешний x402 merchant результат не доказан. |
| C3-01/C3-08, Uniswap token input | Bounded token-input paid proof завершён: SAFE receipt, точные deltas и нулевой residual allowance. Новая release/install acceptance отдельно. |
| C3-04, Jupiter | Разрешить `unknown_finality` указанной подписи через observation-only путь; реальный finalized SOL→USDC receipt и usage charge пока отсутствуют. |
| C3-07, cap refusal | Offline proof принят; свежая installed/current-owner acceptance отдельно. |
| C3-09, MCP swap | Реальный local-candidate MCP quote→prepare→status Uniswap и CLI paid proof готовы. Новая APN release/install acceptance остаётся отдельно; успешный live MCP Jupiter quote не доказан. |
| Release/distribution | Новая npm/Homebrew публикация и установка отсутствуют. Local-only QA не выдаётся за CI/artifact attestation. |

External Avalanche merchant search снят Тони с текущей очереди. Это решение не меняет историческое acceptance на PASS.
