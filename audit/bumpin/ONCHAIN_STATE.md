# Bumpin Trade — estado on-chain decodificado (mainnet-beta)

Todas las direcciones de abajo están **verificadas contra transacciones reales de mainnet**
y los layouts se han **validado byte a byte** contra la asignación de espacio observada.

## Verificación del layout (Anchor `repr(C)` + bytemuck)
| cuenta | tamaño calculado desde el IDL on-chain | tamaño observado on-chain | delta |
|---|---|---|---|
| `User` | 7 608 (7 600 + 8 discriminador) | **7 608** (`initialize_user` tx 5ZuC2WJj…) | **0** |
| `Pool` | 568 (560 + 8) | **568** | 0 |
| `TradeToken` | 216 (208 + 8) | **216** | 0 |
| `State` | 376 (368 + 8) | **376** | 0 |

⇒ **El IDL on-chain de `idl.solana.com` es byte-exacto para el programa desplegado.**
El "IDL Program ID Mismatch" del Explorer es sólo porque el campo `address` del IDL apunta a
`94bfdkcc7cBfucpWKQb9X1ftQFfvLp7eXo2iLRemd89Q` (un deployment anterior) mientras que el
programa vivo es `bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2`.

## Mapa de PDAs (derivados y verificados)
| PDA | seed | valor |
|---|---|---|
| `state` | `["bump_state"]` | `dqwtbXM1woknJ79z1KhEw8erbN7W3RzFeZeaCi1KrtG` |
| `pool[i]` | `["pool", u16le(i)]` | 0=`6nUVAcC53y7G6wFUCDzdkFwNSziXaziNQwLj5RUCjc98`, 1=`HKuLjGCNXaWZDyurbBY7z6Kr1tKKrxh79VvUw2uMHzfb`, 2=`BY5yZxhxTpFyc7t1nFEKSCVf5SSFjL4axZFt7WEPjZMk` |
| `pool_vault[i]` | `["pool_vault", u16le(i)]` | 0=`3rUiyAURboCi5dUc9TPZAfBM8r3PUnBimQMixBoaDQNg`, 1=`ET8fVG838ecgEubsJgFuioSxAo1zYyshPXz3t1v8M7Wu` |
| `pool_spl_token[i]` | `["pool_spl_token", u16le(i)]` | 0=`FYGDtmV6EacpDqpLEnT5gktYQD1uGjRVwuYXpzRWgeCm`, 1=`6vWwXz76iZSnxGh75fd4nsZ4eLC9o5m1PNJgnhdPXNCf` |
| `rewards[i]` | `["rewards", u16le(i)]` | 0=`F63yKRnhpGkcJWRP1X6ss5QHqQ3KWuTDgjGHtcVgZ4oK` |
| `trade_token[i]` | `["trade_token", u16le(i)]` | 0=`hHbkzFawXs2gu3CCFvfAqvPpoRY1WxpP42pj6dgaf8R` (USDC) |
| `trade_token_vault[i]` | `["trade_token_vault", u16le(i)]` | 0=`9E6twPbdM3oEAkzQaapg2mo5XKZCJ2MJUwD5aQNBUtS2` |
| `user` | `["user", authority]` | `EKU7c3QhCGuWn1ASsPWtiHFz5pX3gwsWjuyXXmMYAqw9` (authority `2GRH6NUtK1TjPQnAb3segwf9KDJuemRCbaj1FEpSomoU`) |

**Todos verificados contra la tx real `NvPnMH5c…` (place_portfolio_order, slot 461 403 966):
pool_1, pool_spl_token_0, pool_vault_0, rewards_0, trade_token_0, trade_token_vault_0, state.**

## `State` (decodificado)
| campo | valor | interpretación |
|---|---|---|
| admin | `CSjrvxqcMDpW8eZELyHTFkEN7a3HVHuiY9k2SpjiyC2w` | **misma EOA que la upgrade authority** |
| bump_signer | `dqwtbXM1woknJ79z1KhEw8erbN7W3RzFeZeaCi1KrtG` | (= la propia cuenta `state`) |
| keeper_key | `keeperDpnZoKFUtc6RqQpnUP7iRZLGXecMVUzfngWN2` | clave on-curve con prefijo "keeper" |
| minimum_precision_multiple | 1 | |
| pool_rewards_interval_limit | 172 800 | 48 h |
| **minimum_order_margin_usd** | **50 000 000 000** | **$50** (6 dec) |
| trading_fee_usd_pool_rewards_ratio | 0 | |
| **maximum_maintenance_margin_rate** | **1 000** | **1 %** MMR |
| pool_fee_reward_ratio | 60 000 | 6 % |
| market_sequence | 74 | |
| pool_sequence | 4 | |
| **maximum_referrer_fee_rate** | **90 000** | **9 %** |
| trade_token_sequence | 11 | |
| bump_signer_nonce | 255 | |
| bumpin_system_switches | 7 | bit0=trading, bit1=staking, bit2=deposit ⇒ **los 3 activos** |
| **max_profit_leverage** | **200 000** | **200×** |

## `Pool` 0 — **StableCoin pool** (USDC)
- key `6nUVAcC53y7G6wFUCDzdkFwNSziXaziNQwLj5RUCjc98`, 568 bytes
- `pnl` = 0, `apr` = 541, `insurance_fund_amount` = 1 170 540 910 (1,17 USDC), `insurance_unsettle_fund_amount` = 0
- `pool_vault_key` = `3rUiyAURboCi5dUc9TPZAfBM8r3PUnBimQMixBoaDQNg`, `mint_key` = USDC `EPjFWdd5…`
- `launcher_mint` = `FYGDtmV6EacpDqpLEnT5gktYQD1uGjRVwuYXpzRWgeCm`
- `index` = 0, `status` = Normal, **`stable` = true**, `market_number` = 74

## `Pool` 1 — **bstToken pool base (SOL)**, `market_number` = 60
- key `HKuLjGCNXaWZDyurbBY7z6Kr1tKKrxh79VvUw2uMHzfb`
- `pnl` = 0, `apr` = 7 211, `insurance_fund_amount` = 5 705 766 518 (5,71 SOL)
- `pool_vault_key` = `ET8fVG838ecgEubsJgFuioSxAo1zYyshPXz3t1v8M7Wu`
- `mint_key` = `So111…112` (wSOL), `launcher_mint` = `6vWwXz76iZSnxGh75fd4nsZ4eLC9o5m1PNJgnhdPXNCf`
- `index` = 1, `stable` = false, `market_number` = 60

## `Pool` 2 — bstToken pool (SOL), `market_number` = 13
- key `BY5yZxhxTpFyc7t1nFEKSCVf5SSFjL4axZFt7WEPjZMk`, `apr` = 0, `insurance_fund_amount` = 6 148 582
- `mint_key` = wSOL, `stable` = false, `index` = 2

## `TradeToken` 0 — USDC
- key `hHbkzFawXs2gu3CCFvfAqvPpoRY1WxpP42pj6dgaf8R`, 216 bytes
- `mint_key` = USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **`total_amount` = 1 878 732 899** (depósitos USDC) — coincide con el balance USDC observado en la tx
- **`total_liability` = 356 607 722** (USDC prestado)
- `vault_key` = `9E6twPbdM3oEAkzQaapg2mo5XKZCJ2MJUwD5aQNBUtS2`
- `feed_id` = `Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD`
- **`discount` = 99 000 → 99 %** (coincide con el peso USDC de la documentación)
- **`liquidation_factor` = 500 → 0,5 %**
- `index` = 0, `decimals` = 6, `oracle_source` = **ShadowStorm**

## Cuentas de la tx real que el Explorer NO decodifica con el IDL público
- `3rrFwrochTgd8knYWjK2hWKJ4r7a5n2yMBSuFWwnoZJW` — 9 012 bytes
- `AFJHPUrScZvSq4C1uePxYJfsVaAUpoj6csifymVcmgWv` — 8 184 bytes
- `HMYpk4mG7VwHAs1KtEJSBmJqBseqfkNqyBth6KLD6U5c` — sin resolver
Estos NO son `User` (7 608), `Pool` (568), `TradeToken` (216) ni `State` (376).
⇒ Son cuentas de un **layout distinto**: o `Position` (cuenta propia) no publicada en el
IDL on-chain, o cuentas creadas por una **versión anterior del programa** y nunca migradas.
Pista fuerte: el programa se ha **upgraded 4 veces** (2026-01-07, 2026-01-18 ×2, 2026-01-25).
Un `User` de 9 012 bytes = 7 608 + 1 404 ⇒ no encaja con un cambio de array de posiciones
(1 404 / 512 = 2,74 no entero), por lo que **no** es un `User` con más posiciones.

## `Market` 72 (producción, vivo) — `HMYpk4mG7VwHAs1KtEJSBmJqBseqfkNqyBth6KLD6U5c` (616 bytes)
- `pool_key` = `HKuLjGCNXaWZDyurbBY7z6Kr1tKKrxh79VvUw2uMHzfb` (pool_1, wSOL/bstToken)
- `pool_mint_key` = `So111…112` (wSOL)
- `stable_pool_key` = `6nUVAcC53y7G6wFUCDzdkFwNSziXaziNQwLj5RUCjc98` (pool_0, USDC)
- `stable_pool_mint_key` = USDC
- `index_mint_oracle` = `4o4CUwzFwLqCvmA5x1G4VzoZkAhAcbiuiYyjWX1CVbY2`, source = **ShadowStorm**
- **`share_short` = true** ⇒ los cortos se comparten/socializan contra el pool base (pool_1)
- `stable_loss` = 0, `stable_unsettle_loss` = 0
- `market_status` = Normal, `index` = 72, `padding` = u8[11]

## `Market` 60 — `71cNQY1SoZ5SbMFcBKussLStNZBFsg4jitsmVyWwxVvB` (616 bytes)
- Idéntica estructura (pool_1 + pool_0), `share_short` = true, `index` = 60,
  `index_mint_oracle` = `9MizH48tkmdRPf4ocd5UGDS35fqrbAk6Sz8LbX1woeqw` (distinto oráculo por mercado)

## Reconciliación de solvencia (verificada on-chain)
| Magnitud | Valor |
|---|---|
| `TradeToken(USDC).total_amount` | 1 878 732 899 (1 878,732899 USDC) |
| balance real `trade_token_vault_0` | **1 878,732899 USDC** ⇒ **coincide exactamente** |
| balance real `pool_vault_0` (estable) | 800,299293 USDC |
| total USDC en vaults | 2 679,032192 USDC |
| `TradeToken(USDC).total_liability` | 356 607 722 (356,607722 USDC) |
| `Pool(0).insurance_fund_amount` | 1 170 540 910 (1,1705 USDC) |
| `Pool(1).insurance_fund_amount` | 5 705 766 518 (5,7058 SOL) |

⇒ La contabilidad de depósitos USDC **cuadra exactamente** entre el estado del programa y los
balances reales de las token accounts. No hay descuadre de "tracker" en el lado de los depósitos.

## Direcciones de mercado (market PDA = ["market", u16le(index)]) — verificadas
market 60 = `71cNQY1SoZ5SbMFcBKussLStNZBFsg4jitsmVyWwxVvB` (existe)
market 72 = `HMYpk4mG7VwHAs1KtEJSBmJqBseqfkNqyBth6KLD6U5c` (existe)
market 74 = `99pMjqqVoebMK7cmfzEyTgxVryJzaiP9fmsNM5vQS3iy` (NO existe ⇒ `market_sequence`
  es el *siguiente* índice a asignar, no el último creado)

## `Rewards(0)` — `F63yKRnhpGkcJWRP1X6ss5QHqQ3KWuTDgjGHtcVgZ4oK` (200 B)
| campo | valor |
|---|---|
| `pool_un_claim_amount` | 7 879 894 453 (7 879,894453 USDC sin reclamar a LPs) |
| `pool_total_rewards_amount` | 7 879 894 453 (idéntico) |
| `pool_rewards_vault` | `7thzF2YUx2tiM2UJKGZyf8Y4wKcbmT22wUUvcvsMyNWo` |
| `dao_rewards_vault` | `Hv6B9Jh2aAhFaqzvh7FpaRX9At1gvVtCJCtdPXM9hj6x` |
| `dao_total_rewards_amount` | 29 115 425 049 (29 115,425049 USDC) |
| `pool_index` | 0 |

### Flujo real de `collect_rewards` (tx `2w7iqKPyXna…`, 2026-02-09 03:27:02 UTC, slot 399 020 249)
Firmante/pagador: **`keeperDpnZoKFUtc6RqQpnUP7iRZLGXecMVUzfngWN2`** (= `State.keeper_key`).

| cuenta | Δ USDC |
|---|---|
| `pool_vault_0` (3rUiyAU…) | **−5,316069** (paga a LPs) |
| `pool_rewards_vault_0` (7thzF2Y…) | **+0** (ya estaba vacía) |
| `dao_rewards_vault` (Hv6B9Jh…) | **+5,316069** |

- El `dao_rewards_vault` es una **token account con Owner = `GcdcRmBGgMgEHAweGibLbkSrnwYZ3CpWjUWUoX71r1G1`**
  (EOA externa, 0,037 SOL, Owner = System Program ⇒ **no** es PDA del programa).
  Balance actual: **5,340343 USDC**.
  ⇒ La porción DAO de las fees se transfiere a una **EOA**, no a una vault del programa.
  Esto es una decisión de diseño (tesorería DAO off-chain), **no** un exploit:
  el permiso de cobro sigue siendo del programa, que es quien mueve los fondos.
- `pool_rewards_vault_0` tiene balance **0 USDC** pero `pool_un_claim_amount` = 7 879,894453.
  ⇒ El contador de rewards no reclamados se **acumula en el estado**, mientras el dinero
  permanece en `pool_vault_0` (800,299293 USDC) hasta que se reparte.
  **Consecuencia**: `pool_un_claim_amount` (7 879,89) **supera** el saldo del pool vault (800,30).
  Si un LP="#" reclama, el programa tendría que tomar de `pool_vault_0`; con
  `pool_un_claim_amount` > `pool_vault_0.balance`, la operación fallaría por fondos
  insuficientes (⇒ DoS de retirada de recompensas), **no** robo de fondos de terceros.
  **Clasificación**: DoS de fungsi de recompensa (severidad media), **NO** es crítico
  permissionless: no hay forma de que un atacante salga con más de lo que aporta, y el
  daño (recompensas retenidas) no es "captura de fondos de terceros".

## Cuentas de 8 184 B y 9 012 B que el Explorer NO decodifica
`AFJHPUrScZvSq4C1uePxYJfsVaAUpoj6csifymVcmgWv` (8 184 B) y
`3rrFwrochTgd8knYWjK2hWKJ4r7a5n2yMBSuFWwnoZJW` (9 012 B)
apuntan al programa (`Assigned Program Id = bumpinX5wd…`) pero el Explorer responde
**"Failed to decode account data according to the public Anchor interface"**.
⇒ Son cuentas de un layout **no publicado** en el IDL on-chain (p.ej. `Position` /
`UserStake` / `UserStakeInfo`, con el error 6048 `CouldNotFindUserStake` y el
error 6001 `MaximumPositionCountReached` evidenceando un límite *dinámico* de posiciones
y *un stake por usuario*).
- 9 012 − 8 = 9 004 ; 8 184 − 8 = 8 176. Ninguno es múltiplo de 512 (`UserPosition`),
  luego no son un array de `UserPosition` con el layout del IDL público.
- Consecuencia para la auditoría: **la superficie de "stake del usuario" y de "positions
  adicionales" no es auditable a partir del IDL público**, lo que es en sí un hallazgo
  de opacidad (H-4).
