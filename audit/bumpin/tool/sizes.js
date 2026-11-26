// Rust repr(C) layout: each field aligned to its natural alignment, struct aligned to max member align.
function layout(fields){
  const A = {u8:1,i8:1,bool:1,u16:2,i16:2,u32:4,i32:4,f32:4,u64:8,i64:8,f64:8,u128:16,i128:16,pubkey:1};
  let off=0, maxa=1;
  for(const [name,size,align] of fields){
    const a = align ?? A[size] ?? 1;
    maxa=Math.max(maxa,a);
    if(off % a) off += (a - off%a);
    off += size;
  }
  if(off % maxa) off += (maxa - off%maxa);
  return off;
}
// State per IDL chunk 20
const stateIdl = [
 ['admin',32],['bump_signer',32],['keeper_key',32],['essential_account_alt',32*6],
 ['minimum_precision_multiple',16],['pool_rewards_interval_limit',16],['minimum_order_margin_usd',16],
 ['trading_fee_usd_pool_rewards_ratio',4],['maximum_maintenance_margin_rate',4],['pool_fee_reward_ratio',4],
 ['market_sequence',2],['pool_sequence',2],['maximum_referrer_fee_rate',4],['trade_token_sequence',2],
 ['bump_signer_nonce',1],['bumpin_system_switches',1],['max_profit_leverage',4],['padding',4],
];
// ModifyStateParams (IDL chunk 16) mentions 17 knobs; if State had them all it'd be:
const stateFull = [
 ['admin',32],['bump_signer',32],['keeper_key',32],['essential_account_alt',32*6],
 ['minimum_precision_multiple',16],['pool_rewards_interval_limit',16],['minimum_order_margin_usd',16],
 ['trading_fee_staking_rewards_ratio',16],['trading_fee_pool_rewards_ratio',16],['trading_fee_usd_pool_rewards_ratio',16],
 ['borrowing_fee_staking_rewards_ratio',16],['borrowing_fee_pool_rewards_ratio',16],
 ['mint_fee_staking_rewards_ratio',16],['mint_fee_pool_rewards_ratio',16],
 ['redeem_fee_staking_rewards_ratio',16],['redeem_fee_pool_rewards_ratio',16],
 ['pool_rewards_interval_limit',16],
 ['staking_fee_reward_ratio',4],['pool_fee_reward_ratio',4],['maximum_referrer_fee_rate',4],
 ['maximum_maintenance_margin_rate',4],['keeper_key',32],['essential_account_alt',32*6],
 ['bumpin_system_switches',1],['max_profit_leverage',4],
];
const s1 = layout(stateIdl);
console.log('State (IDL chunk 20) layout      =', s1, ' -> with 8B discriminator =', s1+8);
console.log('OBSERVED on-chain State size      = 376');
console.log('  delta =', 376-(s1+8));
// Market
const MarketPosition=[['open_interest',16],['entry_price',16]];
const MarketFundingFee=[['long_acc_funding_fee',16],['short_acc_funding_fee',16],['long_funding_fee_amount_per_size',16],['short_funding_fee_amount_per_size',16],['long_acc_funding_fee_per_size',16],['short_acc_funding_fee_per_size',16],['updated_at',8],['padding',8]];
const MarketConfig=[['tick_size',16],['open_fee_rate',16],['close_fee_rate',16],['maximum_long_open_interest_cap',16],['maximum_short_open_interest_cap',16],['long_short_ratio_limit',16],['long_short_oi_bottom_limit',16],['funding_fee_base_rate',16],['maximum_funding_base_rate',16],['maximum_leverage',4],['minimum_leverage',4],['max_pool_liquidity_share_rate',4],['padding',4]];
const m = layout([['key',32],['symbol',32],['long_open_interest',layout(MarketPosition)],['short_open_interest',layout(MarketPosition)],['funding_fee',layout(MarketFundingFee)],['config',layout(MarketConfig)],['stable_loss',16],['pool_key',32],['pool_mint_key',32],['index_mint_oracle',32],['stable_pool_key',32],['stable_pool_mint_key',32],['stable_unsettle_loss',16],['index',2],['market_status',1],['share_short',1],['index_mint_oracle_source',1],['padding',3]]);
console.log('Market layout =', m, '-> +8 =', m+8);
