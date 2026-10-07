# Закрытие APN: состояние на 7 октября 2026

Закрыты исправление public Permit2 docs/help и полный installed-offline Smart Account retry. Новый локальный package candidate воспроизводится. Эти результаты не закрывают новые paid acceptance строки. В [каноническом backlog](sprint-remaining-2026-09-23.md) остаются 32 исходных ID: 21 done, 5 in_progress, 6 blocked по checkpoint 29 сентября. Уже принятые строки сохраняют свою исходную область доказательства.

Тони 7 октября снял поиск внешнего Avalanche paid-GET merchant с текущих блокеров. Исходные обязанности C2-10 и исторические verdicts сохранены; Avalanche paid PASS не заявлен. План 16 сентября не используется для повторного открытия принятых строк или расширения этих 32 обязательств.

## Что завершено

Public docs/help local commit `2bbee6ea8211403c79ce051cd7473dd37ec6aaa6`, parent `9f2fc8571222ba0f22d753af2f425684fb612e59`, меняет шесть файлов; остальные 3476 tracked files побайтно совпадают. Исправлены install provenance, примеры, включение guide в package и group synopsis. Три catalog/parser/README tests и owned help/catalog/packlist checks прошли. Producer сообщил exit 0 для typecheck/build/test-build, но пустые retained logs не позволяют независимо доказать эти exit codes. [Независимый review](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/public-docs-help-independent-review-2026-10-07.md) принял документацию и help в пределах source scope.

[Smart Account retry](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/c1-smart-account-full-installed-retry-2026-10-07.md): 6/6, ноль failures/cancelled/skips/todo, 675388.881292 ms (11 минут 15 секунд), exit 0. Он использовал frozen fixture `9f2fc8571222ba0f22d753af2f425684fb612e59` и старый archive `44bc4860338b4de853b67ee772e4cd086a9ae51289d61f806c3a2cab247a6865`, producer `203f67ee4db66ffb64083e01bf29ff34419d4974`; все 2177 installed files совпали. После 29 owned descendants не осталось процессов. Первый запуск с четырьмя setup hook failures и нулём pass сохранён: fixture-side dependency subset не включал viem. Retry исправил owned harness setup; product regression этим сбоем не установлен. MetaMask 36/36 от 6 октября также использовал старый archive и final `9f2fc857` fixtures. Core 3290 + boundary 3 были prepack pass у parent `203f67ee`, а не полным prepack текущего candidate. Synthetic fixtures не доказывают real TEE, browser consent или paid acceptance.

[Новый локальный unpublished candidate](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/candidate-capture-2026-10-07/mode-corrected-report.md) версии 0.5.35 имеет producer `2bbee6ea`, tree `4cafad2e6c08ae1070710f2976c2a3d7d9ce099b`, SHA-256 `74c0d92db05d63af094010c27a6677a5bfbd3a378ee8dfa13847d17f38d02617`, 2178 members. Два packs совпали; local SBOM и unsigned manifest create/verify прошли. Добавлен только guide, изменены четыре общих members: README, package.json, catalog.js и map; остальные content/headers совпали со старым archive. QA Smart Account/MetaMask на `44bc4860` не переименована в QA `74c0d92d`. Глобально установленная ранее released 0.5.35 не менялась. Позднее exact `74c0d92d` один раз установлен offline без lifecycle в отдельный owned runtime: 2178 payload files совпали побайтно и по modes, 1270 dependency packages следуют frozen plan. [Retained V1 evidence](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-owner-command-2026-10-07/original-v1/evidence.json) и [installation report](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-owner-command-2026-10-07/original-v1/review.md) фиксируют пять installed help routes и восемь parser routes. Это limited installed discovery, без полного runtime/financial QA; полный SA 6/6 и MM 36/36 остаётся доказательством старого `44bc4860`. Этот ledger не входит в package payload.

## Исходные 32 строки

Статус в третьем столбце перенесён из checkpoint **29 сентября**, а не получен новым acceptance run. Для принятых строк свежий replay не требуется. Последний столбец фиксирует только доказанные изменения или оставшуюся работу.

| ID | Исходная строка | Статус 29 сентября | Доказательство / оставшаяся работа на 7 октября |
| --- | --- | --- | --- |
| C1-01 | Local gasless Polygon | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C1-02 | Local gasless Ethereum | blocked | Нужны действующая Ethereum local-gasless policy, sponsor/RPC и новая допустимая fee quote; ETH/USDT сейчас неизвестны после HTTP 403. |
| C1-03 | Avalanche PayAI alternative | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C1-04 | MetaMask Agent | blocked | Offline MetaMask 36/36 (6 октября) на старом архиве; нужны реальный provider login, account permissions и отдельные 8/8 USDC receipts. |
| C1-05 | Smart Account fix | blocked | Полный installed-offline Smart Account retry 6/6; нужны свежие browser consent, child permissions и живой Base USDC receipt. |
| C1-06 | Coinbase gasless | blocked | Нужны Coinbase provider/account и installed no-money prepare/recovery, затем отдельный Base receipt; readiness не проверена. |
| C1-07 | Solana SOL and USDC | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C1-08 | TRON TRX and USDT | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C1-09 | LI.FI EVM bridges | in_progress | Нужны Arbitrum→Ethereum USDC и отдельный WBTC acceptance, свежие policy/funding/fee и distinct archive RPC; новых bridge effects нет. |
| C1-10 | Solana/TRON bridges via Circle and 1Click | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C1-11 | Dependency audit | done | Сохранён done для runtime mitigation. Исторически пять high bigint-buffer records остаются installed; upstream fixes/removal требуют отдельной проверки. |
| C1-12 | Repeat direct EVM 9/9 plus gasless Base | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C2-01 | Owner list and limits | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C2-02 | Batched portfolio balances | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C2-03 | Native coin EVM/TRON/Solana | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C2-04 | Non-USDC EVM/TRON token | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C2-05 | Non-USDC Solana token | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C2-06 | Unlisted token/network refusal | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C2-07 | Non-USDC cap refusal | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C2-08 | Direct transfers on eight more EVM networks | in_progress | Свежие balance-only reads: Monad 33.842954192226693011 MON, Sei 0 SEI. Прямые Monad и Sei prepare/receipt открыты; historical 7/8 относится к NETWORK-DELIVERY. |
| C2-09 | LI.FI non-USDC bridge | in_progress | Нужны новая native Stargate quote/prepare, подходящая policy и fee/funding, source/destination effects и APN receipt/recovery. |
| C2-10 | Non-USDC gasless and x402 | in_progress | Public Permit2 docs/help исправлены и локальный candidate зафиксирован. Ethereum USDT gasless current-owner/provider/receipt открыты; Avalanche merchant search снят с текущих блокеров, paid PASS не заявлен. |
| C2-11 | Owner priority fee on direct EVM | done | Сохранена bounded Base приёмка; отрицательный above-budget refusal остаётся непроверенным. |
| C3-01 | Uniswap V3 Ethereum | blocked | Нужны действующая swap policy, fresh funded token-input quote/prepare, exact approval, swap/output receipt и residual allowance; старые expired operations не использовать. |
| C3-02 | SunSwap V2 TRX→USDT | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C3-03 | Orca SOL→USDC | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C3-04 | Jupiter Solana | in_progress | Свежий bounded public search не нашёл ABI всех 11 Quantum accounts и JUP6 executable/source attestation; signable:false, signer/sender/observer/recovery/finalized swap открыты. |
| C3-05 | Status without resend | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C3-06 | Slippage refusal | done | Исходная приёмка сохранена; новой приёмки этой строки 7 октября нет. |
| C3-07 | Amount-cap refusal | done | Сохраняется offline done; fresh installed/current-owner-policy acceptance остаётся отдельным follow-up. |
| C3-08 | Approval no greater than input | blocked | Нужны живые token-input approval/output/allowance proof совместно с C3-01; offline regression не закрывает этот слой. |
| C3-09 | MCP swap | done | Сохраняется offline done; live MCP quote/prepare/status и разрешённый paid run остаются отдельным follow-up. |

## Ближайшие открытые действия

C2-08 содержит ровно восемь сетей: Optimism 10, Avalanche 43114, Linea 59144, Unichain 130, Polygon 137, BNB 56, Monad 143 и Sei 1329. Исторический счётчик 7/8 измерял NETWORK-DELIVERY и включал Relay BNB→Monad. Direct Monad receipt не доказан; fresh Sei prepare/receipt также отсутствует. Новый direct numerator не вычислен: остальные шесть сетей здесь повторно не проверялись.

[Readiness refresh](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/live-readiness-refresh-2026-10-07.md) на 01:51:22 UTC проверил только public metadata owner `default` и policy. Шесть revisions и activations, active head rev6/seq6, истекли `2026-10-06T10:00:41.322Z`; evaluator возвращает `allowlist_policy_expired`. Эта policy допускает только Monad native/direct, 0.01 MON/transfer и 0.03 MON/day. Ethereum, Base, Sei, bridge и Pimlico admissions отсутствуют. Все 12 public policy/activation file hashes сохранились при обычном transient read lock. Provider record отсутствует; encrypted/native custody не доказана. Семь RPC env vars отсутствовали только в shell этого executor. Ethereum/Base HTTP 403 означают неизвестные funds, не нулевые balances.

Для одного Monad direct run подготовлены V2 helper и launcher с фиксированными 0.000001 MON principal и 0.001 MON whole-transaction quote ceiling. Native CLI поддерживает policy prepare с expected revision 6, genuine foreground TTY activation следующей revision, затем prepare-asset и pay transfer approve с настоящим foreground consent. Helper V1 получил [REJECT](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-owner-command-2026-10-07/original-v1/independent-review.md) за незакреплённый runtime manifest и неполную проверку frozen economics/TTL. [V2 review](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-owner-command-2026-10-07/independent-review-v2.md) принял исправления; 53 pure checks независимо прошли. Exact helper SHA-256: `15ea1f934d72c3b32b2a6e48e72fc35feb477a6ab8d427ff67cf1487dd18d395`. [Launcher review](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-owner-command-2026-10-07/launcher-independent-review.md) принял owner-start.py; 19 pure checks независимо прошли, SHA-256 launcher `d3b987f1b55cbb6e4d0bb8ad8c6dc7459e1f702e353cf97a40dcdc62674e694b`. Оба ACCEPT относятся к bounded helper/launcher contract.

Команда уже передана владельцу: `/usr/bin/python3 /Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-owner-command-2026-10-07/owner-start.py`. Она требует настоящий foreground TTY и спросит реальный recipient без default. Recipient ещё неизвестен; доказательства запуска команды нет. Policy activation, funding, signing, payment и direct Monad receipt этим checkpoint не установлены.

Generic native checks сверяют ADDRESS, не full binding hash; после send есть окно до persistence. Helper journal запрещает повторный запуск dispatch, но не закрывает это SDK окно. Generic resume может повторить send; observe-only resume допустим только для submitted_pending/unknown_finality. `operation status` и `receipt get --operation ID` не выполняют payment, но могут восстанавливать локальное состояние (`local_write`); гарантии no-state-write нет. Новый SDK recovery guarantee не заявлен.

[Quantum refresh](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/public-inputs-quantum-refresh-2026-10-07.md) ограничен пятью queries и восемью opens: authoritative ABI всех 11 ролей и pinned deployed JUP6/source-build attestation не найдено. Mutable upstream pages и reader-blocked history не дают требуемого pin. C3-04 остаётся Jupiter Solana, `signable:false`; отправленных запросов провайдеру нет.

Для остальных live lanes нужны действующая owner policy, точно выбранные profile/provider, RPC capability и fresh fee/funding перед конкретным prepare. Repo runner API вернул 0; APN-доступный Camino route не подтверждён. Workflow macOS ARM build и запрет self-hosted attestation требуют согласования с правилом исполнения CI на четырёх Camino runners. Новый CI не запускался. Push, merge, publication, global install и live payment этим checkpoint не выполнены. Windows/Linux C4-01 остаётся optional/unstarted вне 32 строк.

Редакторская правка убрала повторные выводы и неопределённые заявления о готовности. По существу добавлены только dated evidence и открытые действия; исходные acceptance states, обязанности и retained digests сохранены.
