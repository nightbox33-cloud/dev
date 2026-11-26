# Bumpin Trade — modelo contable reconstruido y verificado

## 1. Dual-pool (documentación oficial + on-chain)

```
Mercado M  ──┬── pool base   (pool_index)        : bstToken del baseToken del mercado
             │                                    ⇒ absorbe PnL de LARGOS y CORTOS
             └── pool estable (stable_pool_index)  : USDC/USDT
                                                  ⇒ sólo respalda CORTOS
                                                  ⇒ "totalmente blindado" por la
                                                    transferencia de cortos al pool base
```
On-chain verificado: `Market.pool_key` = pool_1 (wSOL) y `Market.stable_pool_key` = pool_0 (USDC)
para los mercados 60-73. `Market.share_short = true` ⇒ los cortos se socializan contra pool_1.

## 2. Campos contables (IDL on-chain, `repr(C)` + bytemuck)

### PoolBalance (80 B)
| campo | tipo | significado |
|---|---|---|
| `settle_funding_fee` | i128 | funding pagado (negativo = pagador) |
| `amount` | u128 | saldo liquidado del pool |
| `hold_amount` | u128 | **retenido** (margen pledged / órdenes en curso) |
| `un_settle_amount` | u128 | saldo aún no liquidado (unsettled) |
| `loss_amount` | u128 | pérdidas acumuladas del pool |

### FeeReward (32 B) — semántica documentada en el propio IDL
| campo | doc oficial del IDL |
|---|---|
| `fee_amount` | "Fees generated from staking, redeeming, and position operations… **Used in isolated margin mode** (since fees are **actually transferred** each time they are generated). See: `fee_processor::collect_long_open_position_fee`" |
| `un_settle_fee_amount` | "Accounting for fees generated from **cross-margin** position operations." |

### PoolConfig (56 B)
`minimum_stake_amount`, `minimum_un_stake_amount`, `pool_liquidity_limit`,
`borrowing_interest_rate`, `stake_fee_rate(u32)`, `un_stake_fee_rate(u32)`,
`un_settle_mint_ratio_limit(u32)`, `padding[4]`.

### MarketConfig (IDL)
`tick_size`, `open_fee_rate`, `close_fee_rate`, `maximum_long_open_interest_cap`,
`maximum_short_open_interest_cap`, `long_short_ratio_limit`, `long_short_oi_bottom_limit`,
`funding_fee_base_rate`, `maximum_funding_base_rate`, `maximum_leverage(u32)`,
`minimum_leverage(u32)`, `max_pool_liquidity_share_rate(u32)`.

### Market (616 B on-chain)
`long_open_interest`/`short_open_interest` : MarketPosition{open_interest u128, entry_price u128}
`funding_fee` : MarketFundingFee
`stable_loss` : **i128** (pérdida realizada ya transferida al pool estable)
`stable_unsettle_loss` : **u128** (pérdida aún no transferida)
`pool_key`, `pool_mint_key`, `index_mint_oracle`, `stable_pool_key`, `stable_pool_mint_key`,
`index(u16)`, `market_status`, `share_short(bool)`, `index_mint_oracle_source`.

### UserToken (96 B con padding)
`amount` (saldo del usuario), `used_amount` (usado como collateral/liability),
`liability_amount` (deuda), `token_mint_key`, `user_token_status{INIT,USING}`.

### UserPosition (512 B con padding)
18 campos u128/i128 de margen/PnL + 7 pubkeys + `position_id`, `updated_at`,
`leverage(u32)`, `is_long(bool)`, `index_mint_oracle_source`, `is_portfolio_margin`,
`status{INIT,USING}`.

## 3. Parámetros de producción on-chain (verificados)
| parámetro | valor | escala |
|---|---|---|
| `State.maximum_maintenance_margin_rate` | 1 000 | **1 % MMR** |
| `State.minimum_order_margin_usd` | 50 000 000 000 | **$50** (6 dec) |
| `State.pool_fee_reward_ratio` | 60 000 | 6 % |
| `State.maximum_referrer_fee_rate` | 90 000 | 9 % |
| `State.max_profit_leverage` | 200 000 | **200×** |
| `State.bumpin_system_switches` | 7 | trading+staking+deposit activos |
| `TradeToken(USDC).discount` | 99 000 | **99 %** (peso de collateral) |
| `TradeToken(USDC).liquidation_factor` | 500 | 0,5 % |
| `TradeToken(USDC).oracle_source` | ShadowStorm | |
| `Pool(0)` estable | mint USDC, `stable=true`, `market_number`=74 | |
| `Pool(1)` base | mint wSOL, `stable=false`, `market_number`=60 | |
| `Pool(2)` base | mint wSOL, `stable=false`, `market_number`=13 | |
| Moon (API oficial) | maxLeverage 1000, minLeverage 500, openFee 1e-5, closeFee 2e-4 | |
| Standard (API oficial) | closeFee 1e-3 (0,1 %) | |
| Error 6063 `MarketNumberNotEqual2Pool` | invariante: 1 mercado ⇔ 2 pools | |

## 4. Reconciliación on-chain (PASS)
- `TradeToken(USDC).total_amount` = 1 878 732 899 == balance real `trade_token_vault_0` (1 878,732899) ✔
- `pool_vault_0` = 800,299293 USDC; total USDC vaults = 2 679,03 USDC
  (coherente con USDC TVL 2 746 850 de DefiLlama + posiciones en otros tokens)
- `TradeToken(USDC).total_liability` = 356 607 722 USDC
- `Pool(0).insurance_fund_amount` = 1,1705 USDC ; `Pool(1)` = 5,7058 SOL

## 5. Invariantes que el código DEBE mantener (candidatos a bug si se violan)
1. `trade_token_vault.balance == TradeToken.total_amount` (PARTICIPANTES en vault, no prestadas)
2. `TradeToken.total_amount >= TradeToken.total_liability`
3. `Pool.balance.amount + hold_amount + un_settle_amount == balance real de pool_vault`
   (+ `loss_amount` si el pool lleva pérdidas)
4. `sum(Market.stable_loss) == Pool(estable).balance.loss_amount` (tras rebalance)
5. `Market.stable_loss` y `Market.stable_unsettle_loss` no pueden ambos ser > 0 a la vez
   por la misma pérdida (doble conteo)
6. `User.tokens[i].used_amount + liability_amount <= amount`
7. `Pool.fee_reward.fee_amount` (físico) y `un_settle_fee_amount` (contable) no se suman dos veces
   al distribuir
8. `User.hold` ≥ suma de `hold_pool_amount` de posiciones + órdenes en curso
9. `Market.long_open_interest.open_interest <= Market.config.maximum_long_open_interest_cap`
   (idem corto) — si el cap se recalcula con un tracker incompleto, se permite OI no respaldado
10. `Pool.balance.loss_amount` acumulado nunca supera `insurance_fund_amount` + `pnl` negativo

**Los invariantes 4/5/7/9 son el análogo estructural del C-1 de Liquity** (tracker de respaldo
incompleto ⇒ rama "capped"/ADL/"rebalance" se activa sobre posiciones que aún están cubiertas
⇒ fondos de terceros capturados). Sin fuente no se puede demostrar la violación de ninguno,
y sin RPC no se pueden leer `Pool.balance` ni `Market.config` anidados (el Explorer no expone
la expansión cliente-side de los sub-structs).
