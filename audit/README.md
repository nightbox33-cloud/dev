# Auditoría Liquity v1 — hallazgos y PoCs

**Commit auditado (producción mainnet):** `5174ecd0da4842157aba989499200d690b7e374f`
(PR #473 `liquity/public-tellor`, 2021-04-01). Es exactamente el valor del campo
`"version"` de `packages/lib-ethers/deployments/default/mainnet.json`
(`startBlock: 12178551`, `deploymentDate: 1617611590000`).

**HEAD del repo (no desplegado):** `3e64ee1b52c50d51587c64c1cf75e0ba82934979`.

---

## Hallazgo crítico #1 — TCR inflado en la liquidación en modo Recovery

**Ubicación**
- Repo: `github.com/liquity/dev`
- Commit: `5174ecd0da4842157aba989499200d690b7e374f` (**código desplegado en mainnet**)
- Archivo: `packages/contracts/contracts/TroveManager.sol`
  - `_getTotalFromBatchLiquidate_RecoveryMode()` — **línea 722** (ruta batch)
  - `_getTotalsFromLiquidateTrovesSequence_RecoveryMode()` — **línea 583** (ruta secuencial)
  - `_liquidateRecoveryMode()` — líneas 349-424 (rama de liquidación *capped*)
  - `_getCappedOffsetVals()` — líneas 467-489

### Código defectuoso (commit de producción, línea 722)

```solidity
// Update aggregate trackers
vars.remainingLUSDInStabPool = vars.remainingLUSDInStabPool.sub(singleLiquidation.debtToOffset);
vars.entireSystemDebt = vars.entireSystemDebt.sub(singleLiquidation.debtToOffset);
vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToSendToSP);   // <-- omite collSurplus y collGasCompensation
```

En la línea 583 (ruta `liquidateTroves`):

```solidity
vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToSendToSP).sub(singleLiquidation.collSurplus);
// <-- omite collGasCompensation
```

Ese tracker `vars.entireSystemColl` alimenta el TCR con el que se decide la rama de
liquidación *capped* (línea 715):

```solidity
uint TCR = LiquityMath._computeCR(vars.entireSystemColl, vars.entireSystemDebt, _price);
...
} else if ((_ICR >= MCR) && (_ICR < _TCR) && (singleLiquidation.entireTroveDebt <= _LUSDInStabPool)) {
    // liquidación CAPPED: el SP recibe coll equivalente a 1.1 * debt
```

### Por qué las defensas no lo frenan

1. Una liquidación *capped* mueve **todo** el collateral del trove fuera del sistema:
   `collToSendToSP` al Stability Pool, `collSurplus` al CollSurplusPool y
   `collGasCompensation` al liquidador. El tracker de producción sólo resta una parte
   (batch: sólo `collToSendToSP`; secuencial: `collToSendToSP + collSurplus`), por lo que
   `entireSystemColl` queda **sobreestimado** ⇒ el TCR queda **sobreestimado**.
2. El TCR sobreestimado hace que `ICR < _TCR` sea **verdadero** para troves cuyo ICR real
   es **≥** al TCR real ⇒ se liquidan con la rama *capped* cuando **no deberían
   liquidarse** (el README del protocolo dice: `ICR >= TCR → Do nothing`).
3. El resultado de la rama *capped* es que el Stability Pool recibe ETH por valor de
   `1.1 × debt` y a cambio entrega su LUSD (de terceros). El exceso de ~10 % del debt de
   la víctima es **ganancia neta para los depositantes del Stability Pool**, y la pérdida
   la asume el dueño del trove (pierde ~10 % de su debt; el resto vuelve como *collateral
   surplus*).

### Condiciones de configuración (leídas del repo)

- `MCR = 1.1e18`, `CCR = 1.5e18` (`packages/contracts/contracts/Dependencies/LiquityBase.sol`)
- `PERCENT_DIVISOR = 200` ⇒ `collGasCompensation = coll / 200` (0,5 %)
- `LUSD_GAS_COMPENSATION = 200e18`
- El modo Recovery se activa cuando `TCR < CCR` (150 %).
- La rama *capped* exige `entireTroveDebt <= LUSDInStabPool` ⇒ el Stability Pool debe
  contener **al menos** el debt de la víctima. En mainnet el Stability Pool ha contenido
  de forma sostenida cientos de millones de LUSD de terceros, por lo que la condición se
  cumple con holgura (no verificable por RPC en este entorno, por diseño del audit).
- El atacante **no necesita ningún rol**: `batchLiquidateTroves()` y `liquidateTroves()`
  son públicas y permissionless; `provideToSP()` también.
- No se requiere flash loan ni role de admin: el atacante sólo necesita (a) ser
  depositante del Stability Pool y (b) esperar/inducir una ventana de Recovery Mode.

### PoC (ejecutado localmente contra el clon de producción)

`audit/PoC_batchTCRBug.js` — ruta `batchLiquidateTroves()`:

```
carol coll/debt: 4000000000000000000000 500000000000000039046875
alice coll/debt: 24750000000000000000   3300000000000000242187
bob   coll/debt: 15000000000000000000   2000000000000000140625
dennis coll/debt: 4800000000000000000000 600000000000000046859375
price: 170000000000000000000
TCR (real) before liquidation: 1359592418347959723  recoveryMode: true
bob   ICR: 1274999999999999910        (>= MCR 1.1 y < TCR  -> rama CAPPED)
carol ICR: 1359999999999999893        (>= TCR real 1359592418347959723 -> NO debería liquidarse)
SP deposits: 596814920398009996875000

LOG TroveLiquidated bob   _debt 0x6c6b935b8bbd422551  _coll 0xb2b269c70c87a92f
LOG TroveLiquidated carol _debt 0x69e10de76676d2d3cedb _coll 0xae823b4c623c7b99c5

carol trove status (1=active, 3=closedByLiquidation): 1 -> 3
carol collateral surplus: 764705882352940923815
SP ETH balance: 3231994117647059075828        (3231.99 ETH = 549 439 USD a 170 USD/ETH)
dennis (atacante) ETH gain: 2961224353706137224589
erin (depositante SP de terceros, sin trove) ETH gain: 270769763940921450000
```

**Resultado:** la víctima (ICR 136,00 % ≥ TCR real 135,959 %) es liquidada; el
Stability Pool recibe 3231,99 ETH (= 549 439 USD) a cambio de 500 000 LUSD **de
terceros**; la ganancia se reparte pro-rata entre **todos** los depositantes del SP
(incluidos depositantes sin ningún privilege: `erin` gana 270,77 ETH sin tener trove).

**Prueba diferencial** (mismo test contra el código **corregido** upstream, HEAD):

| código | status de la víctima | ganancia de `dennis` (atacante) | ganancia de `erin` (tercera parte) | total capturado por el SP |
|---|---|---|---|---|
| prod `5174ecd` (mainnet) | `3` (liquidada) | **2 961,22 ETH** (503 408 USD) | **270,77 ETH** (46 031 USD) | **3 231,99 ETH** (549 439 USD) |
| upstream corregido (`HEAD`) | `1` (intacta) | 11,798 ETH (sólo la liquidación legítima de bob) | 1,079 ETH | 12,876 ETH (legítimo) |

`audit/PoC_liquidateTrovesTCRBug.js` — misma clase de bug en la ruta secuencial
`liquidateTroves()` (línea 583):

```
TCR(real): 1395213675213675104  recovery: true
bob ICR: 1119999999999999913   (rama CAPPED)
carol ICR: 1399999999999999890  (>= TCR real -> no debería liquidarse)
carol status: 3
attacker ETH gain: 4065285714285714534208
```
- prod `5174ecd`: víctima liquidada, atacante **+4065,29 ETH**
- upstream corregido: víctima intacta, atacante **+156,36 ETH**

`audit/PoC_batchTCRBug_max.js` — batch de 10 troves: el error de tracking **se acumula**
(el margen `[TCR_real, TCR_inflado)` crece con `Σ(collSurplus + collGasCompensation)`):

```
real TCR: 1198399999999999907   recovery: true
victim ICR: 1203999999999999907   trigger ICR: 1189999999999999908
liquidations: 10        <-- las 6 legítimas + las 4 QUE NO DEBÍAN
attacker ETH gain: 781785714285714342072  (781,79 ETH)
victim status: 3, 3, 3, 3
```

| | prod `5174ecd` | upstream corregido |
|---|---|---|
| liquidaciones | **10** | 6 |
| status de las 4 víctimas | **3 (liquidadas)** | **1 (vivas)** |
| ganancia del atacante | **781,79 ETH** | 469,07 ETH |
| delta espurio | **+312,72 ETH** | — |

`audit/PoC_thirdPartyProfit.js` — el resultado **no depende de la identidad del atacante**:
`erin` es una depositora pura del Stability Pool (sin trove) y la liquidación la dispara un
tercero no relacionado.

```
liquidations: 10
erin   (depositora de terceros, sin trove) ETH gain: 196998238911109770000  (196,998 ETH)
dennis (atacante)                         ETH gain: 584787475374604534676  (584,787 ETH)
victim status: 3, 3, 3, 3 ;  victim collateral surplus: 7428571428571422556 wei c/u
```

| | prod `5174ecd` | upstream corregido |
|---|---|---|
| liquidaciones | **10** | 6 |
| status de las víctimas | **3** | **1** |
| ganancia de `erin` | **196,998 ETH** | 118,199 ETH |
| ganancia de `dennis` | **584,787 ETH** | 350,872 ETH |

### Confirmación independiente con el test del propio upstream

El equipo de Liquity escribió el test de regresión **antes** del fix
(commit `e70236a08672bfc68ea3206f30632235f616a897`, *"contracts: Add tests for back to
Normal Mode in multi-liquidations"*) y lo dejó **fallando** hasta aplicar el fix
(`b9dcdbd31bcfa27c6e5f648b8f8938be443d066f`, 2021-05-18, y
`47fb4d5647574da2dae1191f8577dc0a895be656`, 2021-09-03).

`audit/Upstream_BatchRecovery_Test.js` contra el **código de producción**:

```
2 passing, 4 failing
1) Batch liquidations -> Two troves over MCR are liquidated:
     Not enough liquidations   -2  +3
2) Batch liquidations -> Stability Pool profit matches:
     Stability Pool ETH doesn't match  -36815000000000000000  +21890000000000000000
3) Batch liquidations -> A trove over TCR is not liquidated:
     Not enough liquidations   -2  +1        <-- exactamente este hallazgo
4) Sequential liquidations -> Two troves over MCR are liquidated:
     Not enough liquidations   -1  +2
```

Contra el código corregido: `5 passing, 1 failing` (el fallo restante es por el cambio
posterior `getMaxAmountToOffset()`, no por este bug).

### El fix upstream (NO desplegado en mainnet)

`b9dcdbd31bcfa27c6e5f648b8f8938be443d066f` — *"contracts: Fix back to Normal Mode issue
in multi-liquidations"* (2021-05-18):

```diff
-                vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToSendToSP).sub(singleLiquidation.collSurplus);
+                vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToOffset).sub(singleLiquidation.collSurplus);
...
-                vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToSendToSP);
+                vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToOffset).sub(singleLiquidation.collSurplus);
```

`git merge-base --is-ancestor b9dcdbd3 5174ecd` ⇒ **false**: el fix es posterior al
despliegue de mainnet. `packages/lib-ethers/deployments/default/mainnet.json` sigue
apuntando a `5174ecd`; no existe manifiesto de despliegue posterior.

### Impacto

- **Permisionless**: `batchLiquidateTroves` / `liquidateTroves` / `provideToSP` son públicas.
- **Fondos de terceros**: el LUSD usado para el offset es el de **todos** los
  depositantes del Stability Pool; la ganancia se reparte pro-rata entre ellos.
- **Pérdida de la víctima**: ~10 % de su debt (su collateral se toma a razón 1,1 en vez
  de dejarse intacto). Con el PoC: 49 980 LUSD de pérdida para la víctima y
  547 250 USD capturados por el atacante.
- **Escenario de mainnet**: cualquier entrada en Recovery Mode (ETH price crash) abre la
  ventana. El atacante elige su propio lote de troves en `batchLiquidateTroves` de forma
  que la banda `[TCR_real, TCR_inflado)` contenga el ICR de su objetivo.

---

## Cómo reproducir

```bash
# 1) Preparar el workspace de PRODUCCIÓN (commit 5174ecd)
git fetch upstream 5174ecd0da4842157aba989499200d690b7e374f
mkdir -p /tmp/prodws && git archive 5174ecd0da4842157aba989499200d690b7e374f packages/contracts | tar -x -C /tmp/prodws
cd /tmp/prodws/packages/contracts
cp <repo>/packages/contracts/solc-local-plugin.js .          # solc 0.6.11 local (npm solc@0.6.11)
#   + parchear hardhat.config.js: require("./solc-local-plugin.js");
#   + hardhatAccountsList2k.js: balance "th.0x..." -> "1000000000000000000000000"
ln -s <repo>/packages/contracts/node_modules node_modules
npx hardhat compile

# 2) Ejecutar los PoCs
npx hardhat test test/PoC_batchTCRBug.js
npx hardhat test test/PoC_batchTCRBug_max.js
npx hardhat test test/PoC_liquidateTrovesTCRBug.js
npx hardhat test test/PoC_backToNormalMode.js
npx hardhat test test/PoC_thirdPartyProfit.js
npx hardhat test test/Upstream_BatchRecovery_Test.js

# 3) Contraste con el código corregido (HEAD)
mkdir -p /tmp/fixedws && git archive HEAD packages/contracts | tar -x -C /tmp/fixedws
#   (mismos parches) -> los PoCs VULN fallan y el CONTROL pasa
```

Nota: `solc-local-plugin.js` fuerza a Hardhat a usar el `soljson.js` de `solc@0.6.11`
descargado del registro npm (el host `binaries.soliditylang.org` no es accesible en este
entorno). `solc` 0.4.23 y 0.5.17 se obtienen igual vía npm.

---

# Auditoría Bumpin Trade (segundo objetivo)

Programa on-chain `bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2`
("Bumpin Trade Program"), Solana mainnet-beta. TVL verificado **3 804 239,70 USD**.

**Veredicto: no crítico demostrado.** El código fuente del programa es **privado**
(los 3 repos públicos de `bumpin-exchange` no contienen el programa), el binario
(1 978 333 B de BPF) **no tiene verified build** ni **security.txt**, y el sandbox
**no tiene RPC** (todos los endpoints RPC dan `SSL_ERROR_SYSCALL`; `fetch_page` sólo
admite GET y Solana RPC exige POST) ⇒ **no hay reimplementación local posible ni PoC
ejecutable**, y reportar un "crítico" exigiría especular sobre lógica interna no
observable.

Lo que **sí** se verificó, sin RPC:
- **IDL on-chain** (`idl.solana.com`, 23 chunks) → **layouts calculados = tamaños
  observados on-chain, delta 0** (`User` 7 608 B, `State` 376 B, `Pool` 568 B,
  `TradeToken` 216 B) ⇒ el IDL es byte-exacto para el binario vivo.
- **PDAs derivadas localmente y verificadas contra una tx real de mainnet**.
- **`State`, `Pool`×3, `TradeToken`, `Market`×2, `Rewards` decodificados** vía
  `/anchor-account` del Solana Explorer; **balances reales reconciliados**
  (`TradeToken.total_amount` == balance de `trade_token_vault_0`, Δ = 0).
- **Flujo de `collect_rewards` trazado tx a tx**.

### Hallazgos (ninguno cumple los 4 criterios de crítico)
| id | severidad | título |
|---|---|---|
| H-1 | **Alta** | 3,8 M USD bajo una única EOA upgradeable (`CSjrvxqcMDpW8eZELyHTFkEN7a3HVHuiY9k2SpjiyC2w`, = `State.admin` = upgrade authority), 4 upgrades en 10 meses, sin verified build, sin security.txt |
| H-2 | Media | `pool_un_claim_amount` = 7 879,89 USDC sin respaldo (`pool_rewards_vault_0` = 0) y por encima de `pool_vault_0` = 800,30 ⇒ **DoS de cobro de recompensas**; la porción DAO se transfiere a una **EOA** externa |
| H-3 | Media | IDL on-chain con `address` = `94bfdkcc…` ≠ programa desplegado (el Explorer lo marca "potentially fraudulent IDL"); 2 cuentas del programa (8 184 B y 9 012 B) **no decodificables** ⇒ superficie de *stake*/*positions* no auditable |
| H-4 | Media | Audit CertiK de ene-2025 (44 hallazgos, 0 críticos, 17 "Acknowledged") contra binario vivo de ene-2026 |

**Línea de investigación prioritaria** (análogo del C-1 de Liquity, no demostrable sin
fuente): la doc del propio IDL distingue `Pool.fee_reward.fee_amount` (fees **físicas**,
modo isolated) de `un_settle_fee_amount` (fees **sólo contabilizadas**, modo cross).
Si la ruta cross-margin sumara ambas al distribuir, un operador de cross-margin podría
acuñar fees.

Documentación completa en [`bumpin/`](bumpin/) — ver [`bumpin/REPORT.md`](bumpin/REPORT.md).

---

# Actualización — segunda ronda de búsqueda de un 0-day en Liquity v1

Tras C-1 se hizo una ronda específica para intentar un 0-day **más agresivo**. Resultados:

| trabajo | resultado |
|---|---|
| Historial completo de `liquity/dev` + `git merge-base --is-ancestor` | **7 fixes de seguridad posteriores al commit desplegado y NO desplegados**. 2 = C-1. `7fea84a3` (underflow del SP) **descartado**: el revert exige `debtToOffset < T/1e18 ≤ 1000 wei` frente a `MIN_NET_DEBT` = 1 800 LUSD ⇒ DoS inalcanzable. `82e2a886`+`288f500d` (escala de `P`) **descartados**: pérdida simétrica, sin transferencia de valor entre depositantes. `0e32e8a0` cosmético. `800e820f` no aplica a v1 |
| `audit/PoC_ValueExtractionFuzzer.js` — 8 estrategias permissionless + verificador de conservación de valor | **sólo C-1** da ganancia (+255,67 ETH). E2 −594 540 ETH, E3 −49 545 ETH, E4/E5/E6/E7 sin creación de valor, E8 = C-1 |
| `audit/PoC_NetPnL.js` / `PoC_SequentialNetPnL.js` | **PnL NETO del atacante medido end-to-end**: +255,67 ETH (+43 464 USD) batch, +257 ETH (+43 749 USD) secuencial. Control upstream: la víctima sobrevive, atacante +1,01 ETH ⇒ **Δ = +254,66 ETH** |
| `audit/PoC_SequentialMultiVictim.js` | **límite de escalado medido**: 1 víctima por secuencia (N=1,2,3 → siempre 1). Control upstream: **0** en los tres casos |
| Prueba de identidad código auditado == código desplegado | `version` = commit auditado; **14 logs de despliegue** prueban que los contratos **nunca** se redeployaron; Etherscan "Exact Match" con `v0.6.11+commit.5ef660b1` y "100 runs"; **sin proxy**; el Stability Pool sigue activo (42 087 tx, actividad 1 h antes) |
| Teorema de cota del daño de C-1 | El error del tracker es **siempre positivo** (nunca defla el TCR) ⇒ no existe la variante "liquidar troves con ICR < MCR". La victimización queda acotada al **9,45 % del debt** de la víctima, **1 por lote**, con techo = el LUSD del SP |

**Conclusión**: no hay un segundo 0-day. C-1 es real, permissionless, está en el código
desplegado (verificado) y es la **extracción máxima** por esa vía.

## PoCs añadidos en esta ronda

| fichero | qué mide |
|---|---|
| `audit/PoC_NetPnL.js` | PnL NETO del atacante batch (producción vs upstream corregido) |
| `audit/PoC_SequentialNetPnL.js` | PnL NETO del atacante en la ruta secuencial |
| `audit/PoC_SequentialMultiVictim.js` | límite de escalado (N = 1, 2, 3 víctimas) |
| `audit/PoC_ValueExtractionFuzzer.js` | 8 estrategias permissionless + conservación de valor |
| `audit/PoC_MaxScale.js` | análisis del tracker inflado con N víctimas |
| `audit/PoC_DeepProbe.js` | sondas sobre el underflow del SP y la escala de `P` |
