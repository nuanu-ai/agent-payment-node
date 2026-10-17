# C2-08: принятый Monad native direct transfer, 7 октября 2026

Один прямой перевод 0.000001 MON получил terminal APN receipt и отдельный independent PASS по primary RPC. C2-08 остаётся in_progress: Sei funding, prepare и direct receipt ещё открыты. Исторические 7/8 NETWORK-DELIVERY включали Monad bridge; новый общий direct numerator здесь не вычисляется.

## Разрешение и runtime

Тони подтвердил whole-fee ceiling 0.005 MON для прежнего намерения default → evm-live-seller. Авторизованный агент исполнил genuine SDK в foreground PTY, один раз ввёл показанный код и дал Native подписать и отправить одну транзакцию. Это принятие terminal/code в SDK; физическое typing человека не аттестовано.

Financial runtime: source `2bbee6ea8211403c79ce051cd7473dd37ec6aaa6`, archive SHA-256 `74c0d92db05d63af094010c27a6677a5bfbd3a378ee8dfa13847d17f38d02617`, 2178 payload files проверены перед каждым child и sealing. Этот paid run имеет собственное доказательство. Исторические full Smart Account 6/6 и MetaMask 36/36 остаются QA старого `44bc4860`, а не нового archive.

Policy revision 7, digest `1443f27325fcc465a02210c91fa7a4ecb10d6b9d2f356aead8c5adc3fedb7832`, была активна: только Monad native/direct, 0.01 MON/transfer и 0.03 MON/day, expiry `2026-10-07T10:41:32.785Z`. Renewal не выполнялся.

## Исходный отказ и same-intent recovery

Первый unsigned запуск с ceiling 0.001 MON остановился на prepare-dispatched до approval/sign/send. Его lost child error не восстановлен; отдельный текущий unsigned расчёт воспроизводил fee-budget refusal. Исходный journal сохранён побайтно, SHA-256 `86691fc67d97a6ee9f6c5701b68a1b684e1c7d1c998b96d31deef87a983d29ee`.

После нового разрешения fresh genuine status не нашёл сохранённой operation. Idempotency resolver допустил одну recovery prepare с тем же key `apn-monad-direct-20261007-default` и ID `5e9c7fd667cb7c4d4d4c354ab8bbb434e2da127a52e2941daa3914929db9064a`. Выполнены одна prepare, одна approval, один sign/send и один observation-only resume. Resend, повторной approval, generic resume и нового payment key не было. Completed recovery journal SHA-256 `b1bf4c6df116603be31306f0c0f5b5f3ba788bba6f038a8763efd43b31c004c0` хранится отдельно от старого отказа.

## Транзакция и комиссия

| Поле | Доказанное значение |
| --- | --- |
| Chain / asset | Monad `eip155:143`, native MON, 18 decimals |
| Sender | default `0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14` |
| Recipient | evm-live-seller `0x991e254B5C8e0AAf6c244eaa2706BAd059809b04` |
| Principal | 1000000000000 wei = 0.000001 MON |
| Transaction | `0x991097c8d57e674f6b13829806c7ba7321d8ae590e338f977e6f034912af5cc0` |
| Nonce / status | 1 / receipt status 1 |
| Inclusion block | 111284929, hash `0x67525d14b481a01261ab85f0444d0f6a44aa68cceb8ea8e33f6c6bdb564ec548` |
| Prepared fee quote / approved ceiling | 0.004242 / 0.005 MON |
| Actual gas / effective price | 21000 / 102 gwei |
| Actual fee / principal plus fee | 0.002142 / 0.002143 MON |

Максимальная quote рассчитана как 21000 × 202 gwei. Реальная fee равна 21000 × 102 gwei = 2142000000000000 wei. Public SDK receipt не содержит actual gas/fee; их доказывает [same-transaction public RPC artifact](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-agent-recovery-2026-10-07/same-transaction-public-rpc.json), SHA-256 `20788f467c74b6f4108885f80464a97cc5403d09e42aaa70870bb473c87b8f6b`. Whole-fee ceiling применяется к pre-submission quote; on-chain fee enforcement не заявлено.

## APN receipt и independent chain proof

APN завершил тот же ID: `completed`, terminal true, reason `confirmed_exact_native_transfer`, proof `included_native_transaction_and_receipt`, receipt hash `1a244058e909f808a4a827635b00f7aeaba3297bf299e9262c928ee607354e4d`. Finality APN: `rpc_safe_inclusion`, inclusion block 111284929 ниже recorded safe head 111285080, safe hash `0x825597733659461282026d74b2e93e5819906bf3f48d4ef372d38013eabd61c6`. `transactionVerified=true`; balance-delta proof в SDK не заявлен. [Receipt artifact](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-agent-recovery-2026-10-07/receipt-final.json), SHA-256 `cfda6b92841d66ad6339c75818bf1cab7990608bb1ea95446e18740f14223fd5`.

[Independent verification](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-native-independent-verification-2026-10-07.md) в 09:16:17 UTC вернула PASS: chain 143, exact sender/recipient/value, status 1, canonical inclusion block и finalized head 111285730 (safe head 111285731). Это более поздний отдельный finalized RPC proof; сохранённый APN receipt остаётся rpc_safe_inclusion. Recipient balance между parent и receipt block изменился на 1000000000000 wei, но block-level delta может включать другие транзакции; изолированная causal balance proof не заявлена. Chain не аттестует local APN operation ID; его связь с transaction устанавливают local receipt и execution evidence.

[Sei snapshot](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/sei-profile-readiness-2026-10-07.md) в 09:16:57 UTC нашёл 0 SEI у default, buyer и seller. Buyer policy r27/seq24 активна до 15 октября, допускает native/direct Sei 0.01/0.03 SEI. Нужны разрешённое funding по fresh bounded estimate, prepare и direct receipt; новых Sei effects нет.

Это PASS только одного прямого native Monad test. HTTP paid GET, x402, gasless, bridge и остальные 32 acceptance rows этим переводом не подтверждены. Native signer подтвердил адрес; full encrypted binding и устранение SDK post-broadcast crash window не доказаны. Durable journal prevented retries в этом запуске, но общего SDK durability guarantee не добавляет.

## Retained evidence

[Recovery result](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-agent-recovery-2026-10-07/result.md), SHA-256 `15c4d392ecc95ee4cf6592a0afd945ceb79bff646da869ebd1c4cc2114570725`; [result JSON](/Users/tony/Work/Projects/nuanu-ai-lab/reports/apn-sign-command-2026-10-06/monad-agent-recovery-2026-10-07/result.json), SHA-256 `de28abd6b33e1068d8ab79f806e35096c797e19ced614f39b35d395ed40d9cd5`. Independent JSON SHA-256 `0ca43f412ea21a319d6052df52fb3d9ba26e3c32e50d7f3b3bfc9dfac6165827`. Исходные отказ, journals и отчёты сохранены; source, CI, publication, global installation и физическая manual QA этим ledger не обновляются.

Редакторская правка убрала повторные выводы; исходные доказательства сохранены с отдельными proof boundaries.
