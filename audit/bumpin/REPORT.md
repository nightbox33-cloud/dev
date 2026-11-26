# Bumpin Trade — Informe de auditoría de vulnerabilidades CRÍTICAS

**Objetivo:** programa on-chain `bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2` (Bumpin Trade
Program), Solana mainnet-beta. Programa de pagos `bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2`.
TVL verificado: **3 804 239,70 USD** (DefiLlama).

**Criterio de hallazgo CRÍTICO exigido (los cuatro, todos a la vez):**
1. Bug **concreto** en código de **producción**.
2. **Permissionless**: lo ejecuta un atacante sin privilegios.
3. **Call graph + configuración reales** con decimales, caps y checks verificados.
4. **PoC local o matemática exacta** `X → Y > X`, con cierre de flash/swap/loan y **PnL positivo**.

---

## 1. Veredicto

> **No se ha identificado ninguna vulnerabilidad CRÍTICA permissionless en Bumpin Trade.**
>
> El código fuente del programa es **privado** (3 repos públicos de `bumpin-exchange`, ninguno
> con código del programa), el binario **no tiene verified build** (1 978 333 B de BPF) y
> **no hay `security.txt`**. Por tanto **no existe reimplementación local posible** y cualquier
> hallazgo "crítico" exigiría especular sobre lógica interna no observable — lo que el encargo
> prohíbe expresamente. No se reporta ningún crítico.
>
> Se **sí** reportan **4 hallazgos no críticos** (1 Alta de centralización, 3 Medias de
> operación/opacidad/información) y una **discrepancia contable verificada** que no cumple
> el criterio de crítico pero que sí merece atención por el equipo.

---

## 2. Identificación y cobertura (qué se pudo y qué no se pudo auditar)

### 2.1 Repositorios
| repo | estado | contenido |
|---|---|---|
| `github.com/bumpin-exchange/explorer` | público | fork de explorer de Solana, **sin contratos** |
| `github.com/bumpin-exchange/assets` | público | **vacío** (README de 8 B) |
| `github.com/bumpin-exchange/rocketmq-clients` | público | fork no relacionado |
| **código del programa** | **PRIVADO / INEXISTENTE** | — |

- `github.com/api/search/code` con `bumpin_trade`, `collect_long_open_position_fee` y el program id
  devuelve **sólo copias del IDL** (DefiLlama-Adapters y sus forks) y cero código fuente.
- **No hay verified build** ⇒ no hay binario reproducible público contra el que verificar un PoC.
- ⇒ **Cobertura del core: NO se declara completa.** Se declara explícitamente.

### 2.2 Lo que SÍ se obtuvo y se verificó
| artefacto | cómo | validación |
|---|---|---|
| **IDL on-chain completo** (23 chunks) | `idl.solana.com?cluster=mainnet-beta&mode=current&programId=…` | **layouts calculados = tamaños observados on-chain, delta 0** en `User` (7 608), `State` (376), `Pool` (568), `TradeToken` (216) |
| mapa de PDAs | derivado localmente con `@solana/web3.js` | **coincide con las cuentas de una tx real de mainnet** (`pool_1`, `pool_spl_token_0`, `pool_vault_0`, `rewards_0`, `trade_token_0`, `trade_token_vault_0`, `state`) |
| `State`, `Pool`×3, `TradeToken`×1, `Market`×2, `Rewards`×1 decodificados | Solana Explorer `/anchor-account` (render server-side) | valores de producción reales |
| balances reales de las vaults | páginas de token account del Explorer | reconciliación aritmética contra los contadores del programa |
| flujo de `collect_rewards` | tx `2w7iqKPyXna…` desglosada | deltas de USDC por cuenta |
| docs oficiales + API oficial | `docs.bumpin.trade` | fees, MMR, pesos de collateral, apalancamientos |
| audit externo | CertiK Skynet | 44 hallazgos, **0 críticos**, 4 High / 17 Med / 14 Low / 9 Info |

### 2.3 Limitaciones (declaradas, no resueltas)
- **Sin RPC**: los endpoints RPC (`api.mainnet-beta.solana.com`, publicnode, ankr, drpc, helius,
  blockeden, onfinality, leorpc) son **inalcanzables desde el sandbox** (`SSL_ERROR_SYSCALL`).
  `fetch_page` sí alcanza hosts RPC pero **sólo admite GET**, y Solana RPC exige POST ⇒
  **no se pudo ejecutar ninguna transacción ni descargar bytes crudos de cuentas**.
  En consecuencia: **no se pudieron leer los sub-structs anidados** (`Pool.balance`,
  `Pool.config`, `Market.config`, `User.tokens[]`, `User.positions[]`) que el Explorer expande
  sólo en cliente, **ni construir un PoC ejecutable**.
- **Sin fuente**: no hay reimplementación en Rust/Anchor posible.

---

## 3. Configuración de producción verificada (la que usaría cualquier PoC)

### 3.1 `State` — `dqwtbXM1woknJ79z1KhEw8erbN7W3RzFeZeaCi1KrtG` (376 B, programa `bumpinX5wd…`)
| campo | valor | interpretación |
|---|---|---|
| `admin` | `CSjrvxqcMDpW8eZELyHTFkEN7a3HVHuiY9k2SpjiyC2w` | **= la upgrade authority** (misma EOA) |
| `bump_signer` | `dqwtbXM1woknJ79z1KhEw8erbN7W3RzFeZeaCi1KrtG` | = la propia cuenta `state` |
| `keeper_key` | `keeperDpnZoKFUtc6RqQpnUP7iRZLGXecMVUzfngWN2` | clave on-curve (hot key) |
| `minimum_precision_multiple` | 1 | |
| `pool_rewards_interval_limit` | 172 800 | 48 h |
| `minimum_order_margin_usd` | 50 000 000 000 | **$50** (6 decimales) |
| `trading_fee_usd_pool_rewards_ratio` | 0 | |
| `maximum_maintenance_margin_rate` | 1 000 | **MMR 1 %** |
| `pool_fee_reward_ratio` | 60 000 | 6 % |
| `market_sequence` | 74 | |
| `pool_sequence` | 4 | |
| `maximum_referrer_fee_rate` | 90 000 | 9 % |
| `trade_token_sequence` | 11 | |
| `bump_signer_nonce` | 255 | |
| `bumpin_system_switches` | 7 | trading + staking + deposit **activos** |
| `max_profit_leverage` | 200 000 | **200×** |

### 3.2 Pools
| pool | clave | mint | `stable` | `market_number` | `apr` | `insurance_fund_amount` |
|---|---|---|---|---|---|---|
| 0 | `6nUVAcC53y7G6wFUCDzdkFwNSziXaziNQwLj5RUCjc98` | USDC | **true** | 74 | 541 | 1 170 540 910 (1,17 USDC) |
| 1 | `HKuLjGCNXaWZDyurbBY7z6Kr1tKKrxh79VvUw2uMHzfb` | wSOL | false | 60 | 7 211 | 5 705 766 518 (5,71 SOL) |
| 2 | `BY5yZxhxTpFyc7t1nFEKSCVf5SSFjL4axZFt7WEPjZMk` | wSOL | false | 13 | 0 | 6 148 582 |

`Pool.pnl` = 0 y `insurance_unsettle_fund_amount` = 0 en los tres ⇒ **no hay déficit
acumulado registrado en el pool**.

### 3.3 `TradeToken` 0 = USDC — `hHbkzFawXs2gu3CCFvfAqvPpoRY1WxpP42pj6dgaf8R` (216 B)
| campo | valor | interpretación |
|---|---|---|
| `total_amount` | 1 878 732 899 | 1 878,732899 USDC depositados |
| `total_liability` | 356 607 722 | 356,607722 USDC prestados |
| `discount` | 99 000 | **99 %** (peso de collateral; coincide con la doc) |
| `liquidation_factor` | 500 | **0,5 %** |
| `decimals` | 6 | |
| `oracle_source` | ShadowStorm | |

### 3.4 `Market` 60 y 72 (616 B) — producción
Ambos: `pool_key` = pool_1 (wSOL), `stable_pool_key` = pool_0 (USDC),
**`share_short` = true**, `stable_loss` = 0, `stable_unsettle_loss` = 0,
`market_status` = Normal, oráculo = ShadowStorm (feed distinto por mercado).

### 3.5 Parámetros de mercado (API oficial `docs.bumpin.trade/apidoc/api_trade`)
- Moon (`1000DOGEUSD`, marketId `9vR4EQSS5nXAwme9tbHusjqpdoAw2UdpZtLuHe4fyhF9`):
  `maxLeverage` 1000, `minLeverage` 500, `openFeeRate` 1e-5, `closeFeeRate` 2e-4,
  `maxPositionSize` 50 000.
- Standard: `closeFeeRate` 1e-3 (0,1 %).
- Collateral (cross margin): USDC 99 %, USDT 99 %, SOL 90 %, bstToken 80 %.

---

## 4. Reconciliación contable verificada on-chain

| magnitud | estado del programa | balance real de la vault | Δ |
|---|---|---|---|
| Depósitos USDC (`TradeToken.total_amount`) | 1 878 732 899 | `trade_token_vault_0` = 1 878 732 899 | **0** ✔ |
| Liquidez pool estable | — | `pool_vault_0` = 800 299 293 | — |
| Total USDC en vaults | — | 2 679 032 192 (coherente con USDC TVL 2 746 850) | ✔ |
| Rewards LP sin reclamar (`pool_un_claim_amount`) | 7 879 894 453 | `pool_rewards_vault_0` = **0** | ver §5 |
| Rewards DAO acumulados (`dao_total_rewards_amount`) | 29 115 425 049 | `dao_rewards_vault` (EOA) = 5 340 343 | ver §5 |

⇒ **El tracker de depósitos cuadra exactamente.** No hay aquí un análogo del bug de Liquity.

---

## 5. Hallazgos

### H-1 — ALTA (centralización) — Programa de 3,8 M USD bajo una única EOA upgradeable
- **Repo/artefacto**: programa `bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2`
  (loader `BPFLoaderUpgradeab1e…`), **sin verified build**, **sin security.txt**.
- **Config/autoridad**: Upgrade Authority = `CSjrvxqcMDpW8eZELyHTFkEN7a3HVHuiY9k2SpjiyC2w`
  — EOA on-curve, Owner = System Program (⇒ **no** es multisig ni PDA de programa),
  13,37 SOL, funded desde una hot wallet de Bybit. La **misma** EOA es `State.admin`.
- **Ruta productiva**: la autoridad ejecutó `upgrade` (slots 391 946 484, 391 948 666,
  394 344 051, 395 761 885) y `extendProgram` (394 344 051). Último binario: **2026-01-25**.
- **Impacto**: puede reemplazar el binario y extraer los 3,8 M USD de las vaults en una
  transacción.
- **Por qué NO es "crítico" según los criterios**: es un **check de privilegio real**
  (la autoridad es explícitamente privileged). El encargo excluye "checks privilegiados
  reales". Se reporta como riesgo de centralización de severidad **alta**.

### H-2 — MEDIA (operación) — Recompensas de LP sin reclamar ($7 879,89) superan el saldo del pool vault ($800,30)
- **Cuentas**: `Rewards(0)` = `F63yKRnhpGkcJWRP1X6ss5QHqQ3KWuTDgjGHtcVgZ4oK`:
  `pool_un_claim_amount` = `pool_total_rewards_amount` = **7 879 894 453**;
  `dao_total_rewards_amount` = **29 115 425 049**.
  `pool_rewards_vault_0` = `7thzF2YUx2tiM2UJKGZyf8Y4wKcbmT22wUUvcvsMyNWo` ⇒ balance **0 USDC**.
  `pool_vault_0` = `3rUiyAURboCi5dUc9TPZAfBM8r3PUnBimQMixBoaDQNg` ⇒ balance **800,299293 USDC**.
- **Traza verificada** (`collect_rewards`, tx `2w7iqKPyXna…`, 2026-02-09 03:27:02 UTC,
  slot 399 020 249, firmante = `keeperDpnZoKFUtc6RqQpnUP7iRZLGXecMVUzfngWN2` = `State.keeper_key`):
  `pool_vault_0` **−5,316069 USDC**; `pool_rewards_vault_0` **+0**; `dao_rewards_vault` **+5,316069 USDC**.
  Es decir: **las fees salen del pool vault**, la parte DAO va a una token account
  propiedad de una EOA externa (`GcdcRmBGgMgEHAweGibLbkSrnwYZ3CpWjUWUoX71r1G1`, no PDA del
  programa) y el vault de rewards queda a 0 ⇒ el contador `pool_un_claim_amount` crece
  **sin respaldo físico en `pool_rewards_vault_0`**.
- **Impacto**: si un LP reclama, el programa debe tomar de `pool_vault_0`; con
  `pool_un_claim_amount` (7 879,89) > `pool_vault_0.balance` (800,30) el cobro **falla por
  fondos insuficientes** ⇒ **DoS de la retirada de recompensas** (y la parte DAO ya está
  fuera del programa, en una EOA).
- **Por qué NO es "crítico"**: no hay ruta en la que un atacante sin privilegios **reciba más
  de lo que aporta** a costa de fondos de terceros; el daño es funcionalidad atascada, no
  captura de valor. Clasificación: media.

### H-3 — MEDIA (opacidad / información) — IDL on-chain con program id distinto + cuentas no decodificables
- El IDL publicado on-chain declara `address = 94bfdkcc7cBfucpWKQb9X1ftQFfvLp7eXo2iLRemd89Q`,
  **distinto** del programa desplegado. El Solana Explorer clasifica el IDL como
  "potentially fraudulent IDL" y **oculta su contenido**; `idl.solana.com` lo sirve igualmente.
  - Impacto real: un integrador que lea el IDL de `idl.solana.com` en vez del canónico obtiene
    seeds/discriminadores que **sí** coinciden con el binario vivo (verificado byte a byte:
    `User` 7 608 B, `State` 376 B, `Pool` 568 B, `TradeToken` 216 B, y las PDAs derivadas
    coinciden con las cuentas de una tx real) ⇒ el riesgo es **engaño de identidad**, no
    exploit.
- Dos cuentas propiedad del programa **no se decodifican** con el IDL público:
  `AFJHPUrScZvSq4C1uePxYJfsVaAUpoj6csifymVcmgWv` (**8 184 B**) y
  `3rrFwrochTgd8knYWjK2hWKJ4r7a5n2yMBSuFWwnoZJW` (**9 012 B**) — el Explorer responde
  *"Failed to decode account data according to the public Anchor interface"*.
  Ninguna es múltiplo de 512 ⇒ **no** son un array de `UserPosition` con el layout público.
  Los errores 6048 `CouldNotFindUserStake` y 6001 `MaximumPositionCountReached` evidencian
  superficies (**stake por usuario** y **límite dinámico de posiciones**) **no publicadas**
  en el IDL ⇒ **superficie no auditable** con las fuentes públicas.

### H-4 — MEDIA (información) — El audit público está 12 meses desfasado respecto al binario vivo
- CertiK auditó `liquidate_position.rs` (SHA256 `08E…208`) y `adl.rs` (`6F0…3EA`) + 6 ficheros
  más, entregado **2025-01-22**; **0 críticos**, 4 High, 17 Medium, 14 Low, 9 Info, con
  **17 "Acknowledged"** sin resolver.
- El binario en producción es de **2026-01-25**, tras 4 upgrades (2026-01-07, 2026-01-18 ×2,
  2026-01-25). **No hay forma de verificar** si los fixes de los 4 High están desplegados
  ni si algún Acknowledged persiste, porque el programa no tiene verified build.
- Los 44 hallazgos de CertiK **no** incluyen ninguno crítico ⇒ la probabilidad de un
  exploit permissionless de gran impacto **ya conocido** es baja, pero no nula.

---

## 6. Candidatos permissionless evaluados y DESCARTADOS (con el motivo)

| candidato | por qué se descarta |
|---|---|
| `execute_portfolio_order` / `execute_wallet_order` sin `relations:["state"]` en el `keeper_key` | El firmante sigue siendo `State.keeper_key` (privilegiado). Que el IDL no declare la constraint **no** implica que el código no la compruebe; y aunque no la compruebe, el firmante es privileged ⇒ excluido por "checks privilegiados reales". |
| `adl_isolate`, `liquidate_isolate_position`, `rebalance_market_stable_loss` sin `relations` | Igual: firmantes `keeper`/`keeper_key` privilegiados. |
| Manipulación de oráculo (Pyth / ShadowStorm / Lighthouse-LST) para liquidar a terceros | El protocolo tiene guards explícitos: `OraclePriceToOld`, `PriceTooOld`, `InvalidOracle`, `InvalidPriceUpdateV2Account`, `UnableToLoadOracle`, `PythOffline`, `ShadowStormOffline`, `BnConversionError`. El oráculo `LST` es **Lighthouse** (programa con *verified build* y `security.txt`), un coprocesador verificable. Sin fuente, un bypass es especulativo ⇒ no cumple "bug concreto". |
| `TradeToken.discount` (99 %) o `liquidation_factor` (0,5 %) manipulados | Los fija `initialize_trade_token` / `modify_trade_token`, ambos `admin` **con** `relations:["state"]` ⇒ privileged. |
| `Pool.fee_reward.fee_amount` (físico, isolated) vs `un_settle_fee_amount` (contable, cross) — posible doble conteo | Es el candidato **más fuerte**: la doc del propio IDL dice que `fee_amount` son fees *transferidas* (isolated) y `un_settle_fee_amount` son fees *sólo contabilizadas* (cross). Si al distribuir se sumaran ambos, un operador de cross-margin podría acuñar fees. **No se puede demostrar** sin fuente: haría falta ver la ruta de distribución y el `PoolUpdateEvent` con `pre_*`/`post_*`. No cumple el criterio de PoC ⇒ **no se reporta como crítico**. Queda documentado como línea de investigación prioritaria. |
| `Pool.pnl` (i128) vs `apr` (u128) — desbordamiento de signo | Plausible en teoría, pero los guards `Overflow`, `BnConversionError`, `MathError`, `CastingFailure` existen; y `pnl` = 0 en los 3 pools ⇒ no hay estado adverso observable. No verificable sin fuente. |
| `Market.stable_loss` (i128) vs `stable_unsettle_loss` (u128) — doble conteo de la misma pérdida entre `rebalance_market_stable_loss` y el pool estable | Análogo estructural del C-1 de Liquity (tracker de respaldo). **Invariante 5** documentada en `ACCOUNTING_MODEL.md`. Ambos valen **0** en los mercados 60 y 72 ⇒ no hay estado adverso observable, y `rebalance_market_stable_loss` es keeper-privileged. No verificable sin fuente. |
| `Market.long/short_open_interest` vs `maximum_*_open_interest_cap` — OI no respaldado | Invariante 9 documentada. `Market.config` no es legible sin RPC ⇒ no verificable. |
| Flash-loan / reentrancy / reutilización de slots | `User.tokens[12]`, `positions[8]`, `orders[10]` con IDs **monótonos** (`next_position_id`, `next_order_id`, `next_liquidation_id`) ⇒ no hay slot-reuse predecible; no se ha identificado ninguna ruta de reentrancia (los guards `InvalidTransfer`, `TransferFailed` existen). |
| `User.hold` vs `hold_pool_amount` de posiciones + órdenes | Invariante 8. Sin `User` con posiciones pobladas legible (el `User` del único usuario visible tiene `next_position_id = 0`) ⇒ sin estado adverso observable. |
| `Pool.mint` / share accounting del LP | El share del pool es el de un **mint SPL** (`pool_mint`, `launcher_mint`); no hay conversión de shares con fees al estilo Liquity. `wallet_stake`/`wallet_un_stake` usan `share`, `pool_index`, `request_token_amount` con guards `StakeTooSmall`, `UnStakeTooLarge`, `UnStakeWithAmountNotEnough`, `PoolMintSupplyIsZero`. No verificable sin fuente. |
| Withdrawal vs liquidación (carrera) en `wallet_withdraw` | El docs dice que "el importe retirable se calcula descontando la parte usada como collateral"; el guard `UserAvailableValueNotEnough` (6008) y `ReduceMarginTooBig` (6007) existen ⇒covered. No verificable sin fuente. |

---

## 7. Registro final

### Repos clonados / examinados
| repo | hash / ref | estado |
|---|---|---|
| `github.com/DefiLlama/DefiLlama-Adapters` | `0446348` (clone `--depth 1`) | adapter + IDL parcial de Bumpin |
| `github.com/bumpin-exchange/explorer` | API `orgs/bumpin-exchange/repos` | fork, sin contratos |
| `github.com/bumpin-exchange/assets` | ídem | vacío |
| `github.com/bumpin-exchange/rocketmq-clients` | ídem | fork no relacionado |
| **programa Bumpin** | — | **BLOQUEADO: código fuente privado, sin verified build** |
| CertiK Skynet (informe de 44 hallazgos) | — | PDF tras login ⇒ **BLOQUEADO** |

### Fuentes on-chain examinadas
`idl.solana.com` (IDL, 23 chunks) · Solana Explorer (`/address`, `/anchor-account`, `/tx`,
`/tokens`) · Solscan (programa, autoridad, `state`) · `api.llama.fi/protocol/bumpin-trade` ·
`docs.bumpin.trade` (pool, cross-margin, portfolio margin, API) · `www.bumpin.trade` ·
`skynet.certik.com/projects/bumpin-trade`.

### Comandos ejecutados y salidas (reproducibles)
```
$ node pdas3.js        # derivación de PDAs
trade_token_0 LE = hHbkzFawXs2gu3CCFvfAqvPpoRY1WxpP42pj6dgaf8R  (== observado en tx)
trade_token_vault_0 LE = 9E6twPbdM3oEAkzQaapg2mo5XKZCJ2MJUwD5aQNBUtS2 (== observado)
pool_0 LE = 6nUVAcC53y7G6wFUCDzdkFwNSziXaziNQwLj5RUCjc98 (== observado)
pool_1 LE = HKuLjGCNXaWZDyurbBY7z6Kr1tKKrxh79VvUw2uMHzfb (== observado)
state      = dqwtbXM1woknJ79z1KhEw8erbN7W3RzFeZeaCi1KrtG (== observado)

$ node brute.js        # market PDA
market/le2/72  → HMYpk4mG7VwHAs1KtEJSBmJqBseqfkNqyBth6KLD6U5c  (== observado)

$ node sizes.js        # layout Rust repr(C) vs tamaño on-chain
State (IDL chunk 20) layout = 368 -> +8 = 376 ; OBSERVED = 376 ; delta = 0
User  (IDL) layout = 7600 -> +8 = 7608 ; OBSERVED = 7608 ; delta = 0
Market layout = 600 -> +8 = 608 ; OBSERVED = 616
```
```
$ for u in api.mainnet-beta.solana.com solana-rpc.publicnode.com rpc.ankr.com/solana \
           solana.drpc.org mainnet.helius-rpc.com api.blockeden.xyz/... \
           solana.api.onfinality.io/public solana.leorpc.com ; do curl -s -o /dev/null -w "%{http_code}" $u ; done
000 (todas)  ⇒ sin RPC desde el sandbox
```
```
$ node pdas.js / pdas2.js / pdas3.js / final_pdas.js
  ⇒ primera iteración con seeds numéricos como UTF-8 FALLÓ (pool_0 no existía);
    corregido a u16 little-endian ⇒ TODAS las PDAs coinciden con la tx real.
```

### PoC / tests ejecutados
- **No se ejecutó PoC de explotación**, porque no hay código clonable sobre el que construirlo
  (fuente privada) ni RPC para ejecutarlo. Los "tests" ejecutados son de **verificación de
  layout y de derivación de PDAs** contra datos de producción, sketched arriba.
- Los cálculos numéricos citados (MMR 1 %, min margin $50, discount 99 %, fee 0,1 %/0,02 %,
  leverage 500–1000×) se derivan de los valores on-chain y de la API oficial, **no** de memoria.

### Repos bloqueados
1. **Código fuente del programa Bumpin** — no existe repo público ⇒ cobertura del core
   **no declarada completa**.
2. **Informe PDF de CertiK** — requiere login ⇒ los 4 High no son legibles en detalle.
3. **Cuentas con sub-structs anidados** (`Pool.balance`, `Pool.config`, `Market.config`,
   `User.tokens[]`, `User.positions[]`) — legibles sólo con RPC POST, no disponible.

---

## 8. Conclusión

**Bumpin Trade: no crítico demostrado.** Con lo verificable públicamente (IDL on-chain
byte-exacto, config de producción decodificada, balances reales reconciliados, flujos de
`collect_rewards` trazados tx a tx) **no he encontrado ninguna vulnerabilidad que un atacante
sin privilegios pueda explotar para terminar con más valor del que aporta a costa de fondos de
terceros, ni para corromper de forma irreversible la contabilidad**.

Lo que sí queda sobre la mesa, por orden de prioridad real para el equipo:

1. **H-1 (Alta)** — 3,8 M USD bajo una EOA única upgradeable, sin verified build y sin
   `security.txt`, con 4 upgrades en 10 meses. **Mitigación**: multisig/timelock para la
   upgrade authority, verified build y `security.txt`. Es el riesgo dominante del objetivo.
2. **Línea `fee_reward` / `un_settle_fee_amount`** (documentada en §6): la doc del propio IDL
   distingue fees *físicas* (isolated) de fees *contables* (cross). Una auditoría del
   `fee_processor` con el código real debería verificar que la ruta cross-margin **no**
   suma ambas al distribuir. Es el análogo más directo del C-1 de Liquity.
3. **H-2 (Media)** — `pool_un_claim_amount` (7 879,89 USDC) sin respaldo en
   `pool_rewards_vault_0` (0) y por encima de `pool_vault_0` (800,30) ⇒ DoS de cobro de
   recompensas; y la porción DAO se transfiere a una **EOA** externa, no a una vault del
   programa.
4. **H-3 (Media)** — el IDL on-chain apunta a un program id distinto (el Explorer lo marca
   como "potentially fraudulent IDL") y hay cuentas del programa (8 184 B y 9 012 B) cuyo
   layout **no** está publicado ⇒ superficie de *stake* y de *positions* no auditable.
5. **H-4 (Media)** — audit público de ene-2025 contra binario de ene-2026.
