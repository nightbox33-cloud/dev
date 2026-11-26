# Bumpin Trade — on-chain IDL (authoritative, from idl.solana.com)

Program: `bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2` ("Bumpin Trade Program")
IDL `address` field: `94bfdkcc7cBfucpWKQb9X1ftQFfvLp7eXo2iLRemd89Q`  (=> Solana Explorer reports "IDL Program ID Mismatch")
Loader: BPFUpgradeableLoader, Upgrade Authority = `CSjrvxqcMDpW8eZELyHTFkEN7a3HVHuiY9k2SpjiyC2w` (plain EOA, on-curve)
Verified build: NO. security.txt: NO. Last deployed slot: 395,761,885.

## PDA seed map (from IDL)
| account | seeds |
|---|---|
| `state` | ["bump_state"] |
| `user` | ["user", <authority>] (portfolio) / ["user", params.user_authority_key] (order paths) |
| `market` | ["market", <index>] / ["market", state.market_sequence] |
| `pool` | ["pool", <pool_index>] / ["pool", state.pool_sequence] |
| `stable_pool` | ["pool", <stable_pool_index>] |
| `pool_vault` | ["pool_vault", <pool_index>] |
| `stable_pool_vault` | ["pool_vault", <stable_pool_index>] |
| `trade_token` | ["trade_token", <index>] / ["trade_token", state.trade_token_sequence] |
| `trade_token_vault` | ["trade_token_vault", <index>] |
| `launcher_mint` | ["pool_lp_token", <pool_index>] |
| `pool_rewards_vault` | ["pool_rewards_vault", <pool_index>] |
| `rewards` | ["rewards", <pool_index>] |

NOTE: `pool` and `stable_pool` share the SAME seed prefix "pool" and differ only by the index argument.
Same for `pool_vault` / `stable_pool_vault` ("pool_vault").

## Instruction surface (from on-chain IDL)
| instruction | signer/permission |
|---|---|
| `initialize_state` | admin |
| `initialize_market` | admin (relations: state) |
| `initialize_pool` | admin |
| `initialize_trade_token` | admin |
| `keeper_initialize_market` | keeper (no relations check) |
| `modify_state` / `modify_market` / `modify_pool` / `modify_trade_token` / `modify_rewards` | admin (relations: state) |
| `initialize_user` | authority signer + payer signer |
| `place_portfolio_order` / `place_isolate_order` | user authority signer |
| `execute_portfolio_order` / `execute_wallet_order` | **keeper_key signer** (no `relations: state` on execute_portfolio_order) |
| `wallet_cancel_order` | authority |
| `wallet_stake` / `wallet_un_stake` | authority |
| `wallet_deposit` / `wallet_withdraw` | authority |
| `update_cross_position_leverage` / `update_isolate_position_leverage` | authority |
| `adl_cross` | **keeper_key signer, relations: state** |
| `adl_isolate` | keeper_key |
| `liquidate_isolate_position` | keeper |
| `liquidate_user_pay_liability` | **keeper_key signer, relations: state** |
| `rebalance_market_stable_loss` | keeper |
| `claim_*` | - |

## Key state structs
`State`: admin, bump_signer, keeper_key, essential_account_alt[6], minimum_precision_multiple,
pool_rewards_interval_limit, minimum_order_margin_usd, trading_fee_usd_pool_rewards_ratio,
maximum_maintenance_margin_rate, pool_fee_reward_ratio, market_sequence, pool_sequence,
maximum_referrer_fee_rate, trade_token_sequence, bump_signer_nonce, bumpin_system_switches,
max_profit_leverage.

`Pool`: key, name[32], pnl(i128), apr(u128), insurance_fund_amount, insurance_unsettle_fund_amount,
balance: PoolBalance{settle_funding_fee(i128), amount, hold_amount, un_settle_amount, loss_amount},
borrowing_fee: BorrowingFee{total_borrowing_fee, total_realized_borrowing_fee,
cumulative_borrowing_fee_per_token, updated_at},
fee_reward: FeeReward{fee_amount, un_settle_fee_amount}, referrer_fee_reward: FeeReward,
config: PoolConfig{minimum_stake_amount, minimum_un_stake_amount, pool_liquidity_limit,
borrowing_interest_rate, stake_fee_rate(u32), un_stake_fee_rate(u32), un_settle_mint_ratio_limit(u32)},
pool_vault_key, mint_key, launcher_mint, index, status: PoolStatus{NORMAL,StakePaused,UnStakePaused},
stable, market_number.

`TradeToken`: mint_key, total_liability, total_amount, feed_id, vault_key, name[32],
discount(u32), liquidation_factor(u32), index, decimals, oracle_source: OracleSource{ShadowStorm,Pyth,LST}.

`Market`: key, symbol[32], long_open_interest/short_open_interest: MarketPosition{open_interest,entry_price},
funding_fee: MarketFundingFee{...}, config: MarketConfig{tick_size, open_fee_rate, close_fee_rate,
maximum_long_open_interest_cap, maximum_short_open_interest_cap, long_short_ratio_limit,
long_short_oi_bottom_limit, funding_fee_base_rate, maximum_funding_base_rate, maximum_leverage,
minimum_leverage, max_pool_liquidity_share_rate}, stable_loss(i128), pool_key, pool_mint_key,
index_mint_oracle, stable_pool_key, stable_pool_mint_key, stable_unsettle_loss, index,
market_status: MarketStatus{NORMAL,ReduceOnly,Paused}, share_short, index_mint_oracle_source.

`User`: key, hold(u128), tokens: [UserToken;12], positions: [UserPosition;8], orders: [UserOrder;10],
authority, next_position_id, next_order_id, next_liquidation_id,
user_status: UserStatus{NORMAL,LIQUIDATION,DISABLE}, referrer.

`UserToken`: amount(u128), used_amount(u128), liability_amount(u128), token_mint_key,
user_token_status: UserTokenStatus{INIT,USING}.

`UserPosition`: position_size, entry_price, margin_token_entry_price, initial_margin,
initial_margin_usd, initial_margin_usd_from_portfolio, mm_usd, hold_pool_amount, open_fee,
open_fee_in_usd, realized_borrowing_fee, realized_borrowing_fee_in_usd, open_borrowing_fee_per_token,
realized_funding_fee(i128), realized_funding_fee_in_usd(i128), open_funding_fee_amount_per_size(i128),
close_fee_in_usd, realized_pnl(i128), user_key, user_token_account, margin_mint_key,
index_mint_oracle, position_key, market_key, position_id, updated_at, leverage(u32), is_long(bool),
index_mint_oracle_source, is_portfolio_margin(bool), status: PositionStatus{INIT,USING}.

`UserOrder`: order_margin, order_size, trigger_price, acceptable_price, created_at, order_id,
margin_mint_key, authority, user_token_account, market_key, leverage, order_side, position_side,
order_type, stop_type, status, is_portfolio_margin.

## Params
`ADLParams`: pool_index, stable_pool_index, market_index, trade_token_index, position_key, user_authority_key.
`LiquidateIsolatePositionParams`: position_key, market_index, trade_token_index, pool_index,
stable_pool_index, user_authority_key.
`LiquidateUserPayLiabilityParams`: user_key, liquidation_id, infos: Vec<LiquidateUserPayLiabilityInfo{trade_token_index, keeper_vault}>.
`ExecuteOrderParams`: order_id, user_authority_key.
`CancelOrderParams`: pool_index, order_id.
`UpdatePositionLeverageParams`: is_long, is_portfolio_margin, leverage, market_key, pool_index, stable_pool_index.
`UnStakeParams`: share, pool_index.

## Errors relevant to the risk surface (6000-6109)
AmountNotEnough, SubTradeTokenTotalAmountNotEnough, SubTradeTokenLiabilityAmountNotEnough,
SubHoldPoolBiggerThanHold, SubPoolStableAmountBiggerThanStableAmount, SubPoolAmountBiggerThanAmount,
PositionShouldBeLiquidation, OrderHoldUsdSmallThanHoldUsd, StandardPoolValueNotEnough,
OrderMarginUSDTooSmall, PoolAvailableLiquidityNotEnough, InvalidTransfer, InvalidParam,
OnlyOneTypeOrderAllowed, CurrentMarketPositionAgainstOrder, CurrentMarketOrderAgainstOrder,
OrderNotExist, TokenNotMatch, NoMoreUserTokenSpace, NoMoreOrderSpace, LeverageIsNotAllowed,
PriceIsNotAllowed, LiquidationErrorWithBankruptcyPriceZero, OnlyOneDirectionPositionIsAllowed,
BalanceNotEnough, PythOffline, ShadowStormOffline, Overflow, TransferFailed, UnableToLoadAccountLoader,
CouldNotFindUserToken, UserTokenAccountNotMatched, CouldNotFindUserOrder, CouldNotFindUserPosition,
LiquidatePositionIgnore, OnlyCrossPositionAllowed, OnlyCrossOrderAllowed, OnlyIsolateOrderAllowed,
OnlyIsolatePositionAllowed, CouldNotFindUserStake, UserShouldInLiquidation, UserStakeHasNoMoreClaim,
OracleNotFound, OraclePriceToOld, UnableToLoadOracle, InvalidOracle, BnConversionError, MathError,
CastingFailure, CouldNotLoadMarketData, CouldNotFindMarket, InvalidMarketAccount,
InvalidPriceUpdateV2Account, MarketWrongMutability, MarketNumberNotEqual2Pool, FailedUnwrap,
UserNotEnoughValue, AmountZero, CouldNotLoadTokenAccountData, CouldNotLoadTradeTokenData,
CouldNotLoadPoolData, CouldNotLoadLstPrice, InvalidTradeTokenAccount, InvalidTokenAccount,
InvalidPoolAccount, TradeTokenNotFind, VaultNotFind, MarketNotFind, MarketNotAvailable,
MarketIsReduceOnly, MarketIsPaused, MarketMaxLongInterestReached, MarketMaxShortInterestReached,
MarketLongShortRatioReached, StakePaused, StakeNotSupport, UnStakeNotSupport, StakeToSmall,
UnStakeTooSmall, UnStakeWithAmountNotEnough, UnStakeTooLarge, PositionSideNotSupport,
RewardsNotFound, CouldNotLoadRewards, UserNotFound, CouldNotLoadUserData, PoolSubUnsettleNotEnough,
PoolUnsettleSmallThanTokenLiability, TimestampNotFound, ClaimUnqualified, PoolMintSupplyIsZero,
RebalancedMarketStableLossIgnore, TradingSwitcherIsOff, StakingSwitcherIsOff, DepositSwitcherIsOff,
InvalidOwner, DataLenNotMatch, DeserializeError, DataBorrowError, PriceTooOld, TokenMintNotMatch.

## PlaceOrderParams (full)
market_key(pubkey), size(u128), order_margin(u128), leverage(u32), trigger_price(u128),
acceptable_price(u128), place_time(i64), is_portfolio_margin(bool), is_native_token(bool),
order_side: OrderSide{NONE,LONG,SHORT}, position_side: PositionSide{NONE,INCREASE,DECREASE},
order_type: OrderType{NONE,MARKET,LIMIT,STOP}, stop_type: StopType{NONE,StopLoss,TakeProfit}.

## Instruction/permission matrix (from on-chain IDL)
| instruction | required signer | `relations` |
|---|---|---|
| initialize_state | admin | - |
| initialize_market | admin | state |
| initialize_pool | admin | state |
| initialize_trade_token | admin | state |
| keeper_initialize_market | keeper | (none) |
| modify_state | admin | state |
| modify_market | admin | state |
| modify_pool | admin | state |
| modify_trade_token | admin | state |
| modify_rewards | admin | state |
| modify_user_referral | keeper_key | state |
| modify_user_status | keeper_key | state |
| initialize_user | authority + payer | - |
| place_portfolio_order | authority | - |
| place_wallet_order | authority | - |
| portfolio_cancel_order | authority | - |
| wallet_cancel_order | authority | - |
| wallet_deposit / wallet_withdraw | authority | - |
| wallet_stake / wallet_un_stake | authority | - |
| update_cross_position_leverage | authority | - |
| update_isolate_position_leverage | authority | - |
| execute_portfolio_order | **keeper_key (NO relations)** | (none) |
| execute_wallet_order | keeper_key (NO relations) | (none) |
| adl_cross | keeper_key | state |
| adl_isolate | keeper_key | (none) |
| liquidate_isolate_position | keeper (NO relations) | (none) |
| liquidate_user_pay_liability | keeper_key | state |
| rebalance_market_stable_loss | keeper | (none) |

NOTE: `relations: ["state"]` means Anchor checks that the signer's key equals `state.<field>`.
Which field is NOT derivable from the IDL alone (Anchor resolves `relations` to a single field
of the target account by name). For `admin` the target field is `state.admin`; for `keeper_key`
it is `state.keeper_key`.

## Fee/insurance/borrow accounting fields (all u128 or i128, scaled)
- Pool.fee_reward.fee_amount            : fees from staking/redeem/position ops (isolated margin; physically transferred)
- Pool.fee_reward.un_settle_fee_amount  : fees from CROSS-margin position ops (accounted, not transferred)
- Pool.insurance_fund_amount            : insurance fund
- Pool.insurance_unsettle_fund_amount   : unsettled insurance
- Pool.balance.amount / hold_amount / un_settle_amount / loss_amount / settle_funding_fee(i128)
- Pool.borrowing_fee.total_borrowing_fee / total_realized_borrowing_fee / cumulative_borrowing_fee_per_token
- TradeToken.total_amount (deposits) / total_liability (borrowed) / discount(u32) / liquidation_factor(u32)
- Market.stable_loss(i128) / stable_unsettle_loss(u128)
