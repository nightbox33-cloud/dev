# Informe de auditoría — Liquity v1 (core desplegado en mainnet) y ecosistema integrado

**Fecha:** 2026-11-26
**Modo:** sin RPC. Todos los hechos provienen de clones locales del código, de artefactos
de despliegue incluidos en el repo y de ejecución local de PoCs.
**Rama de trabajo:** `arena/fd2bde3b-dev` (base `3e64ee1b52c50d51587c64c1cf75e0ba82934979`).

---

## 0. Resumen ejecutivo

Se encontró **un (1) hallazgo CRÍTICO** en el core de Liquity v1 desplegado en mainnet, y
se confirmó de forma diferencial (código de producción vs. código corregido upstream) y
además de forma independiente con el **test de regresión escrito por el propio equipo de
Liquity antes de aplicar el fix**.

| # | Severidad | Componente | Ubicación | Permisionless | PnL NETO medido del atacante |
|---|---|---|---|---|---|
| C-1 | **CRÍTICA** | `TroveManager.sol` (core mainnet) | `packages/contracts/contracts/TroveManager.sol` L722 (batch) y L583 (secuencial) | **Sí** | **+255,67 ETH ≈ +43 464 USD** (batch) / **+257 ETH ≈ +43 749 USD** (secuencial), medido end-to-end con la contabilidad completa y el `withdrawFromSP` hecho. Control upstream: la víctima **sobrevive** y el atacante gana sólo +1,01 ETH ⇒ **Δ espurio = +254,66 ETH (+43 292 USD)**. El SP capturó **3 231,99 ETH (549 439 USD)** en un lote de 2; **+781,79 ETH** en un lote de 10 |

**Cota del daño (demostrada y medida)**: **1 víctima por lote**, **9,45 % del debt** de esa
víctima (premium de liquidación al MCR, tomado de su propio collateral), y **techo agregado =
el LUSD del Stability Pool** (fondos de terceros). Detalle y demostración por ramas en §5-bis.3.

**Resultado del resto del stack audited: no crítico.** No se halló ningún otro defecto que
cumpla los cuatro criterios exigidos (bug en código de producción + permissionless +
ruta/call-graph/config real + PoC con `X → Y > X` sobre fondos de terceros).

**Segunda ronda de búsqueda (tras C-1), con resultado negativo documentado** (§5-bis):
los **7 fixes de seguridad upstream** posteriores al commit desplegado se han recuperado del
historial completo y triado uno a uno (2 son C-1; 3 se descartan con modelado matemático
explícito; 1 es cosmético; 1 es un refactor de la era BOLD v2 que no aplica a v1), y un
**fuzzer dirigido de 8 estrategias permissionless** con verificador de conservación de valor
no encuentra ninguna vía adicional de creación de valor. La única estrategia que da dinero
al atacante es C-1.

---

## 1. Identificación del código de producción

### 1.1 Repositorio principal

- Org: `github.com/liquity` — **37 repositorios públicos** enumerados vía
  `gh api orgs/liquity/repos --paginate` (`public_repos=37`).
- Monorepo v1: **`liquity/dev`** ← objeto de esta auditoría.
- `liquity/bold` es v2 (cadena nueva, no mainnet v1) — **fuera de alcance** por no ser el
  stack v1 desplegado.

### 1.2 Commit desplegado (hash exacto)

| Artefacto | Campo | Valor |
|---|---|---|
| `packages/lib-ethers/deployments/default/mainnet.json` | `version` | `5174ecd0da4842157aba989499200d690b7e374f` |
| ídem | `startBlock` | `12178551` |
| ídem | `deploymentDate` | `1617611590000` → **2021-04-05 08:33:10 UTC** |
| `packages/contracts/mainnetDeployment/mainnetDeploymentOutput.json` | direcciones | coincide con el manifiesto |

`git cat-file -t 5174ecd...` → `commit` (traído con `git fetch upstream 5174ecd...`).

**El HEAD del repo (`3e64ee1b52c50d51587c64c1cf75e0ba82934979`) NO es producción.**
Todo el análisis se hizo sobre una extracción limpia del commit de producción:

```bash
git archive 5174ecd0da4842157aba989499200d690b7e374f packages/contracts | tar -x -C /tmp/prodws
```

El commit de fix upstream (`b9dcdbd3…`) **no es ancestro** del commit desplegado
(`git merge-base --is-ancestor b9dcdbd3 5174ecd` ⇒ *false*), y el manifiesto de mainnet
sigue apuntando a `5174ecd` — **no existe manifiesto de despliegue posterior**: el fix
**nunca se desplegó**.

### 1.3 Direcciones mainnet (de `mainnetDeploymentOutput.json`)

| Contrato | Dirección |
|---|---|
| `TroveManager` | `0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2` |
| `ActivePool` | `0xDf9Eb223bAFBE5c5271415C75aeCD68C21fE3D7F` |
| `DefaultPool` | `0x896a3F03176f05CFbb4f006BfCd8723F2B0D741C` |
| `StabilityPool` | `0x66017D22b0f8556afDd19FC67041899Eb65a21bb` |
| `CollSurplusPool` | `0x3D32e8b97Ed5881324241Cf03b2DA5E2EBcE5521` |
| `BorrowerOperations` | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` |
| `GasPool` | `0x9555b042F969E561855e5F28cB1230819149A8d9` |
| `SortedTroves` | `0x8FdD3fbFEb32b28fb73555518f8b361bCeA741A6` |
| `HintHelpers` | `0xE84251b93D9524E0d2e621Ba7dc7cb3579F997C0` |
| `PriceFeed` | `0x4c517D4e2C851CA76d7eC94B805269Df0f2201De` |
| `TellorCaller` | `0xAd430500ECDa11E38C9bCB08a702274b94641112` |
| `LUSDToken` | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` |
| `LQTYToken` | `0x6DEA81C8171D0bA574754EF6F8b412F2Ed88c54D` |
| `LQTYStaking` | `0x4f9Fbb3f1E99B56e0Fe2892e623Ed36A76Fc605d` |
| `CommunityIssuance` | `0xD8c9D9071123a059C6E0A945cF0e0c82b508d816` |
| `Unipool` | `0xd37a77E71ddF3373a79BE2eBB76B6c4808bDF0d5` |
| `LockupContractFactory` | `0x2eBeF24dA09489218Ba2BECb01867F6DaAeDcD4B` |
| `MultiTroveGetter` | `0xFc92d0E9Fa35df17E3A6d9F40716ca2cE749922B` |

### 1.4 Constantes de configuración (leídas del código, no de memoria)

`packages/contracts/contracts/Dependencies/LiquityBase.sol`:

| Constante | Valor |
|---|---|
| `MCR` | `1.1e18` (110 %) |
| `CCR` | `1.5e18` (150 %) |
| `PERCENT_DIVISOR` | `200` → `collGasCompensation = coll / 200` (0,5 %) |
| `LUSD_GAS_COMPENSATION` | `200e18` LUSD |
| `MIN_NET_DEBT` | `1800e18` LUSD |
| `BORROWING_FEE_FLOOR` | `0.005e18` (0,5 %) |
| `DECIMAL_PRECISION` | `1e18` |
| `SCALE_FACTOR` / `PRICE_PRECISION` | `1e18` |

Oráculo: `PriceFeed` on-chain vía **Tellor** (`TellorCaller` → `ITellor.getOracleValue`),
con `_maxWaitForPrice` y `fallback` a `LiquityMath`; **no** hay oráculo de precios
inmutablemente bloqueado ⇒ el precio de ETH es manipulable dentro de límites (ya
considerado por el diseño del protocolo, no constituye el hallazgo C-1).

### 1.5 Parámetros de despliegue

`packages/contracts/mainnetDeployment/deploymentParams.mainnet.js` +
`mainnetDeploymentOutput.json` + `packages/lib-ethers/deployments/default/mainnet.json`
(fee de bootstrap, direcciones de multisig, `_bootstrapPeriod`, etc.) fueron leídos. El
`bootstrapPeriod` de mainnet está en el output de despliegue y no bloquea las rutas de
liquidación analizadas.

### 1.6 Repositorios de la fundación clonados (hash exactos)

| Repo | Commit | Uso en esta auditoría |
|---|---|---|
| `liquity/dev` | `5174ecd0da4842157aba989499200d690b7e374f` (**producción**) | objeto principal del audit |
| `liquity/dev` (HEAD) | `3e64ee1b52c50d51587c64c1cf75e0ba82934979` | control "fixed" |
| `liquity/ChickenBond` | `b417bb74710d491c0e103c53c76f91ff36a2539f` | fallback ecosistema (bLUSD) |
| `Threshold-USD/dev` | `a5484b9738f660726cf8ece94e80bcd53924e91f` | fallback ecosistema (THUSD; **no** es LUSD) |
| `backstop-protocol/dev` | `409ece756492f97197101c8266fdc025021caff6` | fallback ecosistema (BAMM LUSD→Liquity SP) |
| `liquity/community-proxy-scripts` | `febd7843bd5aa7da3778a47d7ff9838962a9787d` | fallback; **sin contratos** (sólo scripts de deploy) |

**Repos bloqueados / no clonables:** ninguno de los repositorios públicos de la
organización quedó inaccesible. `gh api orgs/liquity/repos` devuelve `public_repos=37`; la
API no expone el conteo de repos privados, por lo que **no puede afirmarse cobertura de
repositorios privados**. Ningún repositorio público fue descartado por error de red.

---

## 2. Hallazgo C-1 — TCR inflado en la liquidación en modo Recovery (CRÍTICO)

### 2.1 Ubicación exacta

- Repo: `github.com/liquity/dev`
- Commit: `5174ecd0da4842157aba989499200d690b7e374f` (**el desplegado en mainnet**)
- Archivo: `packages/contracts/contracts/TroveManager.sol`
- Contrato: `TroveManager`
- Funciones y líneas:
  - **L722** — `_getTotalFromBatchLiquidate_RecoveryMode()` (ruta `batchLiquidateTroves`)
  - **L583** — `_getTotalsFromLiquidateTrovesSequence_RecoveryMode()` (ruta `liquidateTroves`)
  - **L349–L424** — `_liquidateRecoveryMode()` (rama de liquidación *capped*)
  - **L467–L489** — `_getCappedOffsetVals()` (cálculo de `collToSendToSP` / `collSurplus`)
  - **L715** — decisión de la rama *capped* (usa el TCR del tracker defectuoso)

### 2.2 El bug

En `_liquidateRecoveryMode` (rama *capped*) la-collar collateral del trove liquidado se
reparte en **tres** cubos:

```solidity
// _getCappedOffsetVals()  (L467-489)
singleLiquidation.collGasCompensation = _getCollGasCompensation(collToOffset);   // 0,5 % -> al liquidador
singleLiquidation.collToSendToSP      = collToOffset.sub(singleLiquidation.collGasCompensation); // -> Stability Pool
singleLiquidation.collSurplus         = _entireTroveColl.sub(collToOffset);       // -> CollSurplusPool
```

El tracker agregado `vars.entireSystemColl` **debe** restar los tres, porque los tres
salen del sistema. El código de producción resta menos:

```solidity
// L583  (ruta secuencial  liquidateTroves)
vars.entireSystemColl = vars.entireSystemColl
                         .sub(singleLiquidation.collToSendToSP)
                         .sub(singleLiquidation.collSurplus);        // <-- omite collGasCompensation

// L722  (ruta batch  batchLiquidateTroves)
vars.entireSystemColl = vars.entireSystemColl
                         .sub(singleLiquidation.collToSendToSP);      // <-- omite collSurplus Y collGasCompensation
```

Ese `vars.entireSystemColl` es la **única** fuente del TCR con el que se decide la rama
*capped*:

```solidity
// L715
uint TCR = LiquityMath._computeCR(vars.entireSystemColl, vars.entireSystemDebt, _price);
...
} else if ((_ICR >= MCR) && (_ICR < _TCR) && (singleLiquidation.entireTroveDebt <= _LUSDInStabPool)) {
    // RAMA CAPPED: el SP recibe ETH por 1,1 x debt y entrega su LUSD
```

### 2.3 Las defensas que existen y por qué NO lo evitan

| Defensa esperada | Por qué no frena el ataque |
|---|---|
| `ICR < TCR` para liquidar | El TCR que se usa es el **inflado** del tracker. Un trove con ICR real ≥ TCR real pasa el test porque el TCR falseado es mayor. |
| `ICR >= MCR` (min liquidation) | La víctima del PoC tiene ICR ≈ 136 % > 110 %. Cumple. |
| `entireTroveDebt <= LUSDInStabPool` | El Stability Pool de mainnet ha sostenido cientos de millones de LUSD de terceros; se cumple con holgura. |
| `TCR >= MCR` para poder liquidar (`_requireTCRoverMCR`) | Se cumple: el modo Recovery exige `MCR < TCR < CCR` (110–150 %), y el TCR inflado sigue en ese rango. |
| `_requireCallerIsTroveManager` en `StabilityPool.offset` | El llamador legítimo es `TroveManager`; el atacante no necesita ser admin, sólo provocar la liquidación. |
| `provideToSP` / `batchLiquidateTroves` / `liquidateTroves` | **Totalmente permissionless**: cualquier EOA puede llamarlas. No hay whitelist, ni multisig, ni rol. |
| Bootstrap period | No afecta a liquidaciones. |

### 2.4 Configuración que hace el ataque explotable

- **`MCR = 1.1e18` / `CCR = 1.5e18`**: la ventana de Recovery Mode es TCR ∈ (110 %, 150 %).
  Cualquier crash de ETH abre esta ventana.
- **`PERCENT_DIVISOR = 200`** ⇒ `collGasCompensation = coll/200` (0,5 % del coll).
- **`LUSD_GAS_COMPENSATION = 200e18`**: 200 LUSD quedan quemados por liquidación.
- **Profundidad del SP**: `entireTroveDebt <= LUSDInStabPool` — se cumple en mainnet.
- **Volatilidad**: un atacante puede elegir su lote (`[bob, carol]`) para que la banda
  `[TCR_real, TCR_inflado)` contenga exactamente el ICR de su objetivo. El margen es
  ≈ `collSurplus + collGasCompensation` del primer trove liquidado, es decir, se puede
  ampliar arbitrariamente con un lote mayor.

### 2.5 Trazado del ataque (call graph real)

```
attacker (EOA, sin ningún privilege)
 ├─ provideToSP(LUSD)              → StabilityPool  (depósito legítimo, attacker's LUSD)
 ├─ [victim] openTrove(...)        → BorrowerOperations → TroveManager (ICR ≈ 136 %)
 ├─ [trigger] openTrove(...)       → ICR ∈ (110 %, TCR)  ⇒ elegible para rama CAPPED
 ├─ (preCIO) priceFeed.setPrice    → caída de ETH ⇒ TCR < CCR ⇒ Recovery Mode
 ├─ batchLiquidateTroves([trigger, victim])
 │     └─ TroveManager._getTotalFromBatchLiquidate_RecoveryMode()  (L722)
 │          • primer trove → liquidation CAPPED
 │               collToSendToSP  → StabilityPool   (SP recibe ETH a 1,1x)
 │               collGasCompensation → attacker
 │               collSurplus     → CollSurplusPool
 │          • vars.entireSystemColl  NO resta collSurplus ni collGasCompensation  ⇒ TCR INFLADO
 │          • segundo trove (la VÍCTIMA, ICR >= TCR real) → ¡CAPPED! (¡no debía liquidarse!)
 └─ attacker.withdrawFromSP(...)   → cobra su parte de las ganancias del SP
```

### 2.6 PoC ejecutados (producción, sin RPC)

#### PoC A — ruta batch: `audit/PoC_batchTCRBug.js`

Escenario (parámetros reales del repo: `MCR=1.1e18`, `CCR=1.5e18`, `PERCENT_DIVISOR=200`):

| Actor | Collateral (ETH) | Debt (LUSD) | ICR @170 USD/ETH |
|---|---|---|---|
| `carol` (**víctima**) | 4 000 | 500 000 | **136,00 %** |
| `alice` | 24,75 | 3 300 | 127,50 % |
| `bob` (**trigger**) | 15 | 2 000 | 127,50 % |
| `dennis` (**atacante**) | 4 800 | 600 000 | 136,00 % |

Precio: 200 → 170 USD/ETH. **TCR real = `1359592418347959723` (135,959 %)**.
`bob` ICR = 127,50 % ⇒ **capped legítimo**. `carol` ICR = 136,00 % ⇒ **≥ TCR real ⇒
NO debería liquidarse**.

Salida en el **código de producción** (`5174ecd`):

```
LOG TroveLiquidated bob   _debt 0x6c6b935b8bbd422551  _coll 0xb2b269c70c87a92f  _operation 2 (liquidateInRecoveryMode)
LOG TroveLiquidated carol _debt 0x69e10de76676d2d3cedb _coll 0xae823b4c623c7b99c5  _operation 2 (liquidateInRecoveryMode)

carol status (1=active, 3=closedByLiquidation): 1 -> 3      <-- VÍCTIMA LIQUIDADA
carol collateral surplus: 764705882352940923815 wei
SP ETH balance:  3231994117647059075828 wei  (3231,99 ETH = 549 439 USD)
dennis (atacante)   ETH gain: 2961224353706137224589 wei  (2961,22 ETH)
erin  (depositante SP de terceros, SIN trove) ETH gain: 270769763940921450000 wei (270,77 ETH)
✔ VICTIM trove with ICR >= real TCR is capped-liquidated; SP depositor gains 547250 USD
```

Salida en el **código corregido upstream** (control):

```
carol status: 1  (intacta)
dennis ETH gain: 12876470588235144580 wei (12,88 ETH)   <- sólo la liquidación legítima de bob
✔ CONTROL: same scenario against the upstream-FIXED tracker gives the attacker only 12.88 ETH
```

| | producción `5174ecd` | upstream corregido |
|---|---|---|
| status de la víctima | **3 (liquidada)** | **1 (intacta)** |
| ganancia de `dennis` (atacante) | **2 961,22 ETH ≈ 503 408 USD** | 12,88 ETH |
| ganancia de `erin` (depositora de terceros, sin trove) | **270,77 ETH ≈ 46 031 USD** | 0 |
| **total capturado por el Stability Pool** | **3 231,99 ETH ≈ 549 439 USD** | 12,876 ETH (legítimo, sólo la liquidación de bob) |

#### PoC B — ruta secuencial: `audit/PoC_liquidateTrovesTCRBug.js`

Mismo defecto en `liquidateTroves()` (L583). Precio 200 → 140; TCR real =
`1395213675213675104`; `bob` ICR = 111,999…% (capped legítimo, MCR = 110 %);
`carol` ICR = 139,999…% (≥ TCR real ⇒ no debería liquidarse).

```
[producción]  carol status: 3      attacker ETH gain: 4065285714285714534208  (4065,29 ETH)
[corregido]   carol status: 1      attacker ETH gain:  156357142857142453520  ( 156,36 ETH)
```

#### PoC B2 — PnL NETO medido end-to-end (`audit/PoC_NetPnL.js`, `audit/PoC_SequentialNetPnL.js`)

Los PoC anteriores miden la **ganancia ETH acumulada del Stability Pool**. Éste mide el
**PnL neto del atacante** con la contabilidad completa: se mide la *riqueza total* del
atacante (wallet ETH + LUSD en wallet + depósito compuesto en el SP + gain ETH pendiente de
retirar) **antes y después** del ataque, y se hace el `withdrawFromSP` para que el profit
sea realizable, no solo una账面.

Escenario (idéntico al validado): precio 200 → 170 USD/ETH; TCR real = `1359592418347959723`
(135,96 %); `carol` (víctima) ICR = `1359999999999999893` (**≥** TCR real ⇒ **no** debería
liquidarse); `bob` (trigger) ICR = `1274999999999999910`; `alice` (whale) ICR 127,5 %;
`dennis` (atacante) aporta LUSD al SP y `erin` (tercera parte, **sin trove**) aporta
50 000 LUSD.

Salida en el **código de producción** (`5174ecd`) — ruta batch:

```
P = 170000000000000000000  TCR real = 1359592418347959723  recoveryMode = true
carol (victima) ICR = 1359999999999999893  >= TCR real? true
SP deposits totales: 596814920398009996875000
carol status: 3 (3 = liquidada)

================= ATACANTE (dennis) =================
  delta ETH (retirado del SP): 2961220262354792434981 = 2961 ETH
  delta USD (ETH): 503407444600314713946770
  delta LUSD (wallet): 86871509705899677973831
  >> PnL NETO de RIQUEZA del atacante (ETH): 255
  >> PnL NETO de RIQUEZA del atacante (USD): 43464033908204395045520   (+43 464 USD)
================= TERCERA PARTE (erin, sin trove) =================
  >> PnL NETO de RIQUEZA (USD): 3974347689595575850090                 (+3 974 USD)
================= STABILITY POOL =================
  ETH antes/despues: 0 -> 270770217632266640847
  LUSD deposits: 596814920398009996875000 -> 7943410692110279713669
  victima carol: coll surplus a su favor: 764705882352940923815
OK: atacante + 43464 USD ; tercera parte + 3974 USD ; la victima pierde 4000 ETH de
    collateral (764 ETH vuelve como surplus)
```

Salida en el **código corregido upstream** (control) — **mismo PoC, mismos parámetros**:

```
carol status: 1 (3 = liquidada)                      <-- la victima SOBREVIVE
  delta ETH (retirado del SP): 11794075340935249387 = 11 ETH
  >> PnL NETO de RIQUEZA del atacante (ETH): 1
  >> PnL NETO de RIQUEZA del atacante (USD): 172548940659747650790    (+172 USD)
  SP ETH: 1078765807300045636
  victima carol: coll surplus a su favor: 0
```

Ruta **secuencial** (`liquidateTroves`, L583), producción:

```
LIQ 0x1b1E98 debt 3300000000000000242187     (alice, whale)
LIQ 0x2E7108 debt 2000000000000000140625     (bob, trigger)
LIQ 0xcB3E7F debt 500000000000000039046875    (carol, VÍCTIMA)
carol status: 3
  ETH retirado: 2980686475243335569129
  >> PnL NETO de riqueza (ETH): 257
  >> PnL NETO (USD @170): 43749
```

**Tabla resumen del PnL neto (medido, no estimado)**

| | producción `5174ecd` batch | producción `5174ecd` secuencial | upstream corregido |
|---|---|---|---|
| status de la víctima | **3 (liquidada)** | **3 (liquidada)** | **1 (intacta)** |
| ETH retirado por el atacante | 2 961,22 | 2 980,69 | 11,79 |
| **PnL NETO del atacante** | **+255,67 ETH ≈ +43 464 USD** | **+257 ETH ≈ +43 749 USD** | +1,01 ETH ≈ +172 USD |
| **Δ profit espurio** | — | — | **+254,66 ETH ≈ +43 292 USD** |
| PnL de la tercera parte depositaria | +23,38 ETH (+3 974 USD) | — | +0,09 ETH (+15 USD) |
| ETH del SP | 270,77 | 272,55 | 10,79 |

**Nota económica importante (corregida con esta medición):** el atacante **no** se lleva
`collSurplus` — ése va al `CollSurplusPool` a nombre de la víctima y ella puede reclamarlo
(verificado: `CollSurplusPool: No collateral available to claim` cuando el atacante lo
intenta). Y la "tercera parte" depositaria del SP **también gana** proporcionalmente, porque
el gain del SP se reparte pro-rata. El valor que el atacante **realmente** extrae es el
**9,45 % del debt** de la víctima liquidada (47 250 USD en este escenario), que el Stability
Pool paga con el LUSD que quema y que los depositantes recuperan en forma de ETH. Es decir:
el atacante gana exactamente el *premio de liquidación al MCR* que la víctima no debería
haber pagado, y lo cobra **a costa del collateral de la víctima**.

**Techo del ataque:** el LUSD del Stability Pool. En este escenario el SP tenía 596 814
LUSD; la víctima consumía 500 000 ⇒ sólo cabía **una** víctima. Con más LUSD de terceros en
el SP, más víctimas por lote. Y **sólo una víctima por lote**: tras la primera liquidación
capped el tracker inflado hace que `backToNormalMode` sea `true`, y el bucle pasa a la
rama de modo Normal, que **omite** los troves con ICR ≥ MCR. Medido: con 4 víctimas,
**1 de 4** capturada; con liquidaciones en transacciones separadas, **0** (el tracker se
reinicia en cada tx ⇒ el TCR real manda y la víctima no es liquidable).

#### PoC B3 — Límite de escalado medido (`audit/PoC_SequentialMultiVictim.js`)

Se ha medido empíricamente **cuántas víctimas** puede capturar el atacante, tanto en la ruta
batch como en la secuencial, y con cuántas víctimas presentes en el sistema.

Ruta **secuencial** (`liquidateTroves(10)`), código de producción:

```
--- N=1 ---   TCR real 1359592418347959723  recoveryMode true
  LIQ: alice:3300e18  bob:2000e18  carol:500000e18
  victimas capturadas: 1 de 1        attacker ETH gain: 2980 ETH
--- N=2 ---   TCR real 1359719367096492761
  victimas capturadas: 1 de 2
--- N=3 ---   TCR real 1359786016244715611
  victimas capturadas: 1 de 3
```

Control con el **código upstream corregido** (mismos parámetros, N = 1, 2 y 3):

```
--- N=1 ---   LIQ: alice:3300e18  bob:2000e18
  victimas capturadas: 0 de 1
--- N=2 ---   victimas capturadas: 0 de 2
--- N=3 ---   victimas capturadas: 0 de 3
```

⇒ **Una sola víctima por lote/ secuencia**, sea cual sea el número de víctimas sanas
presentes. El motivo está en el propio código: tras la primera liquidación *capped*, el
tracker inflado hace que

```
vars.backToNormalMode = !_checkPotentialRecoveryMode(vars.entireSystemColl, vars.entireSystemDebt, _price);
```

sea `true` (el TCR tracker queda por encima de CCR = 150 %), y el bucle pasa a la rama de
modo Normal, que **omite** (`else continue; // In Normal Mode skip troves with ICR >= MCR`)
todos los troves con ICR ≥ MCR = 110 %. Como las víctimas sanas tienen ICR ≈ 136 %, se
saltan todas.

**Techo agregado del ataque**: el LUSD del Stability Pool. En el escenario medido el SP tenía
596 814 LUSD y la víctima consumía 500 000 ⇒ sólo cabía una; tras la liquidación quedaban
91 515 LUSD, insuficientes para otra víctima de 500 000. Con un SP financiado por más
terceros, más víctimas **en lotes separados** (cada uno con su propio trigger), pero nunca
más de una por lote.

**Cota matemática del daño por víctima**: el premium de liquidación al MCR
(`collToOffset = debt·MCR/price`), es decir **9,45 % del debt** de la víctima, con
independencia del precio. Al ser el ICR de la víctima ≥ MCR, la rama *capped* es la única
aplicable y no se puede capturar más que ese premium de su **propio** collateral.

#### PoC C — el mismo tracker también rompe `backToNormalMode`: `audit/PoC_backToNormalMode.js`

`vars.backToNormalMode = !_checkPotentialRecoveryMode(vars.entireSystemColl, vars.entireSystemDebt, _price)`
(L588 / L727) depende del mismo tracker inflado ⇒ el sistema **sigue creyendo que está en
Recovery Mode** y aplica las reglas de Recovery (offset + redistribute) a troves que en
modo normal quedarían intactas. Salida en producción: `carol status: 3`, atacante
`+4065285714285714534208` wei. Esto agrava C-1: el modo de liquidación queda
"clavado" en Recovery por un lote de liquidación mal contabilizado.

#### PoC D — batch grande: el error de tracking se **acumula** (`audit/PoC_batchTCRBug_max.js`)

Diseño (todos los troves con ICR casi idéntico, para que el TCR **real** del sistema quede
justo por debajo del 120 % ⇒ Recovery Mode):

| Rol | Nº | ICR @140 USD/ETH | coll / debt |
|---|---|---|---|
| `victims` | 4 | **120,4 %** (≥ TCR real ⇒ **no** deben liquidarse) | 86 ETH / 10 000 LUSD |
| `triggers` | 6 | 119,0 % (< TCR real ⇒ capped legítimo) | 85 ETH / 10 000 LUSD |
| `dennis` (atacante / financiador del SP) | 1 | 120,0 % | 1 286 ETH / 150 000 LUSD |

Salida en el **código de producción**:

```
real TCR: 1198399999999999907   recovery: true
victim ICR: 1203999999999999907     trigger ICR: 1189999999999999908
batch size: 10
liquidations: 10                              <-- las 6 legítima + las 4 QUE NO DEBÍAN
attacker ETH gain: 781785714285714342072 wei  (781,79 ETH)
victim status: 3, 3, 3, 3                     <-- las 4 víctimas liquidadas
```

Contraste con el **código corregido upstream**:

| | producción `5174ecd` | upstream corregido |
|---|---|---|
| liquidaciones | **10** | 6 (sólo las legítimas) |
| status de las 4 víctimas | **3 (liquidadas)** | **1 (vivas)** |
| ganancia del atacante | **781,79 ETH** | 469,07 ETH |
| **ganancia espuria (delta)** | **+312,72 ETH** | — |

Esto demuestra que el error **escala** con el tamaño del lote: el margen
`[TCR_real, TCR_inflado)` crece con `Σ (collSurplus + collGasCompensation)` de los troves
ya liquidados en el mismo lote, de modo que un atacante puede liquidar **cualquier
número** de troves por encima del TCR real en una sola transacción.

#### PoC E — la ganancia fluye a **terceros** que no son el atacante (`audit/PoC_thirdPartyProfit.js`)

Variante que elimina cualquier dependencia de "el atacante es el beneficiario":

- `erin` es una depositora **pura** del Stability Pool (30 000 LUSD) que **nunca abrió un
  trove** y **no es** quien llama a la liquidación (la llama un tercero no relacionado,
  `A[20]`).
- Los mismos 10 troves del PoC D.

Salida en el **código de producción**:

```
liquidations: 10
erin   (depositora de terceros, sin trove) ETH gain: 196998238911109770000  (196,998 ETH)
dennis (atacante)                         ETH gain: 584787475374604534676  (584,787 ETH)
victim status: 3, 3, 3, 3
victim collateral surplus: 7428571428571422556 wei (7,4286 ETH) cada una
```

Contraste con el **código corregido upstream**:

| | producción `5174ecd` | upstream corregido |
|---|---|---|
| liquidaciones | **10** | 6 |
| status de las víctimas | **3** | **1** |
| ganancia de `erin` (tercera parte) | **196,998 ETH** | 118,199 ETH |
| ganancia de `dennis` (atacante) | **584,787 ETH** | 350,872 ETH |
| collateral surplus de las víctimas | 7,4286 ETH c/u (recuperación parcial) | 0 |

Conclusión de PoC E: **el resultado y sus consecuencias económicas no dependen de la
identidad del atacante**. Cualquier depositante del Stability Pool — incluidos usuarios que sólo
quieren una posición de rendimiento — recibe la ganancia. El atacante sólo necesita
disparar la liquidación; el valor se entrega al Stability Pool y se reparte pro-rata.

#### Confirmación independiente con el test del propio upstream

El equipo de Liquity escribió el test **antes** del fix y lo dejó fallando hasta el fix:

- `e70236a08672bfc68ea3206f30632235f616a897` — *"contracts: Add tests for back to Normal Mode in multi-liquidations"* (2021-05-18, 278 líneas nuevas)
- `b9dcdbd31bcfa27c6e5f648b8f8938be443d066f` — *"contracts: Fix back to Normal Mode issue in multi-liquidations"* (2021-05-18) ← **el fix**
- `47fb4d5647574da2dae1191f8577dc0a895be656` — *"contracts: Fix back to Normal Mode issue in multi-liquidations"* (2021-09-03) — **segunda corrección**: *"The initial fix was wrong, as now for case of ICR between 100% and MCR, collToOffset would be zero, so it wouldn't be subtracted. Besides, subtracting the gas compensation too, which in that case was missed too."*

`audit/Upstream_BatchRecovery_Test.js` (el archivo de test upstream, sin modificar)
contra el **código de producción**:

```
2 passing, 4 failing

1) Batch liquidations -> Two troves over MCR are liquidated:
     Not enough liquidations          -2   +3
2) Batch liquidations -> Stability Pool profit matches:
     Stability Pool ETH doesn't match -36815000000000000000  +21890000000000000000
3) Batch liquidations -> A trove over TCR is not liquidated:
     Not enough liquidations          -2   +1        <== EXACTAMENTE ESTE HALLAZGO
4) Sequential liquidations -> Two troves over MCR are liquidated:
     Not enough liquidations          -1   +2
```

Contra el código corregido: `5 passing, 1 failing` (el fallo restante es por el cambio
posterior y no relacionado `getMaxAmountToOffset()`, que altera la contabilidad del SP).

El nombre del test upstream — **"A trove over TCR is not liquidated"** — es la
confirmación textual del equipo de Liquity de que este comportamiento es un bug.

### 2.7 El fix upstream (NO desplegado)

`b9dcdbd31bcfa27c6e5f648b8f8938be443d066f`:

```diff
-                vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToSendToSP).sub(singleLiquidation.collSurplus);
+                vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToOffset).sub(singleLiquidation.collSurplus);
-                vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToSendToSP);
+                vars.entireSystemColl = vars.entireSystemColl.sub(singleLiquidation.collToOffset).sub(singleLiquidation.collSurplus);
```

`git merge-base --is-ancestor b9dcdbd3 5174ecd` ⇒ **false**. El manifiesto de mainnet
sigue en `5174ecd`. **El fix no está desplegado.**

### 2.8 Impacto y severidad

- **Permisionless**: sí. `batchLiquidateTroves`, `liquidateTroves` y `provideToSP` son
  públicas y sin control de acceso. El atacante sólo necesita ser un depositante del
  Stability Pool y tener LUSD (o comprararlo). **Ni siquiera hace falta que sea él quien
  llame a la liquidación** (PoC E: la llamada la hace un tercero no relacionado).
- **Fondos de terceros**: sí. El LUSD usado en el offset es el de **todos** los
  depositantes del SP; la ganancia se reparte pro-rata entre ellos (PoC E demuestra que
  `erin`, depositora sin ningún privilege ni trove, gana **196,998 ETH**).
- **Pérdida de la víctima**: ~10 % de su debt (su collateral se consume a razón 1,1 en vez
  de dejar el trove intacto); el resto de su collateral vuelve a ella como *collateral
  surplus* (reclamable). En el PoC D: la víctima pierde ≈ 1 000 LUSD por trove liquidado
  espuriamente y recupera 7,4286 ETH de las 86 ETH de collateral.
- **Volumen**: en una sola transacción, 781,79 ETH capturados (PoC D) con 4 troves
  liquidados erróneamente. Repetible en cada lote; el atacante puede trocear la captura en
  muchas liquidaciones. El error de tracking **escala** con el tamaño del lote.
- **Condición de ventana**: una sola entrada en Recovery Mode (caída del precio de ETH por
  debajo del 150 % del TCR) abre la ventana; el resto de ese periodo es explotable por
  cualquiera.
- **Severidad: CRÍTICA.** Pérdida de fondos de terceros, permissionless, irreversible
  (el trove se cierra; la contabilidad del SP ya se movió), y con fix upstream no
  desplegado.

### 2.9 Recomendación

Desplegar el parche de `47fb4d5647574da2dae1191f8577dc0a895be656` (o el estado actual de
`TroveManager.sol` en `master` upstream), que corrige **las dos** rutas. Como mitigación
inmediata hasta el despliegue, los operadores del Stability Pool pueden retirar LUSD
durante la ventana de Recovery Mode y los troveros pueden aumentar su ICR por encima del
TCR real.

---

## 3. Superficies auditadas y resultado (core Liquity v1, commit de producción)

| Superficie | Contrato(s) | Resultado |
|---|---|---|
| Liquidación / trackers | `TroveManager.sol` | **C-1 CRÍTICO** (L583, L722, L588, L727) |
| Redención | `TroveManager._redeemCollateralFromTrove` / `_redeemCloseTrove` / `redeemCollateral` | Correcto: usa saldos reales de los pools (`activePool.decreaseLUSDDebt`), no trackers manuales. Redención parcial con hints y `MIN_NET_DEBT` coherentes. |
| Apertura / ajuste de troves | `BorrowerOperations.sol` | Correcto: `_requireCallerIsTroveManager` en los hooks, `MIN_NET_DEBT`, fee de préstamo con floor, re-inserción en `SortedTroves` protegida por hints. |
| Stability Pool | `StabilityPool.sol` | `offset`/`withdrawFromSP`/`provideToSP` correctamente atribuidos a `msg.sender`; `P`/`S` con corrección de error; `getCompoundedLUSDDeposit` decrece mono (los depositantes de LUSD pierden LUSD y ganan ETH) ⇒ sin drift de interés. Nota: la versión de producción **no** tiene el suelo `MIN_LUSD_IN_SP` (introducido upstream después) ⇒ el SP puede vaciarse a 0; esto es el diseño de producción y no constituye un hallazgo aparte (quien deposita en un SP vacío recupera su parte vía `P`/`S`). |
| Pools | `ActivePool`, `DefaultPool`, `CollSurplusPool`, `GasPool` | Todos los mutadores con `_requireCallerIs*`; `CollSurplusPool.claimColl` paga sólo a `_account` y sólo por su propio surplus. |
| Token | `LUSDToken.sol` | `mint` sólo por `BorrowerOperations`; `burn` por BO/TM/SP; `sendToPool`/`returnFromPool` por SP/TM. Sin mint permissionless. |
| Oráculo | `PriceFeed.sol` + `TellorCaller.sol` | `fetchPrice()` con `lastGoodPrice` de respaldo; sin bypass de firmante. Manipulación de precio acotada por diseño del protocolo (no es C-1). |
| SortedTroves | `SortedTroves.sol` | Inserción/reinserción por `TroveManager`/`BorrowerOperations` únicamente; `_insert` reordena por NICR; no se encontró ruta permissionless de corrupción de la lista. |
| Staking / LQTY | `LQTYStaking.sol`, `LockupContract.sol`, `LockupContractFactory.sol`, `CommunityIssuance.sol` | `totalStaked == 0` → división por cero en `_payOutLQTYGains` ya mitigada con `if (totalStaked == 0)`; el `LockupContract` sólo paga a su propio `owner`. |
| Unipool / LP rewards | `LPRewards/Unipool.sol` | Synthetix-style; `setParams` es privileged (`onlyOwner`); `_notifyRewardAmount` con `assert(periodFinish == 0)`. Sin ruta de robo permissionless. |
| Wrappers de usuario | `Proxy/*.sol` | Passthrough sin lógica; `msg.sender` se preserva. Sin superficie. |
| Oráculos de terceros | `TellorCaller` | `ITellor` + `TellorCaller.getOracleValue`; fallback de precio configurado. |
| Threshold-USD | `Threshold-USD/dev` | **No** es parte del stack Liquity v1 de mainnet (es THUSD); BAMM THUSD análogo, sin integración productiva con Liquity v1. |

### Candidatos descartados (no cumplen los cuatro criterios)

| Candidato | Motivo del descarte |
|---|---|
| `LQTYStaking` con `totalStaked == 0` | División por cero ya gestionada; sin robo de fondos. |
| `StabilityPool` con `newP == 0` / epoch rollover | Comportamiento documentado; los depositantes reciben su parte vía `S`/`P`; sin beneficio neto para un atacante. |
| `PriceFeed` con underflow | `lastGoodPrice` + `require`; no se congela la contabilidad de terceros. |
| `SortedTroves` con `(0,0)` | No muta estado de terceros. |
| Multisig / permit / `Ownable` | Control de acceso real ⇒ no permissionless. |
| Reentrancy con ETH | Pools y `LUSDToken` con guards; `StabilityPool.withdrawETHGainToTrove` usa CEI. |
| Unipool / `LockupContract` | Sin ruta de robo determinista permissionless. |
| `HintHelpers` / `MultiTroveGetter` | Sólo lectura. |

---

### 3.8 Prueba de identidad entre el código auditado y el código desplegado en mainnet

El informe exige que el bug esté **en el código de producción**. Se cierra la cadena con
cuatro evidencias independientes:

**(a) El `version` del artefacto de despliegue es el commit auditado.**
`packages/lib-ethers/deployments/default/mainnet.json` → `"version":
"5174ecd0da4842157aba989499200d690b7e29faAbCf4bb2"`, `"chainId": 1`,
`"startBlock": 12178551`, `"deploymentDate": 1617611590000`
(= 2021-04-05 08:33:10 UTC), `"_priceFeedIsTestnet": false`,
`"bootstrapPeriod": 1209600` (14 días).

**(b) Los 14 logs de despliegue (`packages/contracts/mainnetDeployment/realDeploymentOutput/output1..14.txt`,
del 2021-04-05 al 2021-07-20) demuestran que los contratos núcleo NUNCA se redeployaron.**
Los 12 outputs posteriores al primero repiten literalmente:

```
Using previously deployed troveManager contract at address 0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2
...
Contract troveManager already verified
```

⇒ el **mismo bytecode** en `0xA39739EF…` desde el 2021-04-05 hasta el 2021-07-20 y más allá.

**(c) Etherscan verifica el código desplegado con "Exact Match"** en
`0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2` ("Liquity: Trove Manager"), con:
* Compiler **`v0.6.11+commit.5ef660b1`** (= el `0.6.11` del `hardhat.config.js` del repo),
* **Optimization: Yes with 100 runs** (= `optimizer: { enabled: true, runs: 100 }` del repo),
* `Contract Name: TroveManager`, fichero `contracts/TroveManager.sol`, y el **árbol de imports
  idéntico** (`LiquityBase.sol`, `SafeMath.sol`, `LiquityMath.sol`, `CheckContract.sol`,
  `Ownable.sol`, `console.sol`, `ITroveManager.sol`, …),
* el **outline de funciones idéntico**, incluida `_updateSystemSnapshots_excludeCollRemainder`.

**(d) El contrato sigue vivo y sin proxy.** Etherscan: `ContractCreator: Liquity: Deployer
(0xa850535d3628cd4dfeb528dc85cfa93051ff2984)`, tx de creación
`0x79140d00043308c0ce59ab09a6fe0a9abc719e1399740690bffe82b2555d5690`, **1 684 transacciones**.
El Stability Pool (`0x66017D22b0f8556afDd19FC67041899Eb65a21bb`) acumula **42 087 transacciones**
y sigue en uso **1 hora antes de la consulta** (`Provide To SP` / `Withdraw From SP` el
2026-11-26). No hay proxy ni mecanismo de actualización: los contratos son inmutables.

**Hashes keccak-256 del runtime compilado localmente desde `5174ecd`** (para verificación
independiente por terceros):

```
TroveManager        0xf8c273990a874bed6df81fd7866698f1bf87a2757e23378c0ba90719fd7505c4
StabilityPool       0x20e8862f21bea79e50462ac6014d615c12976a8b8e3e8725a04a834c6875b446
BorrowerOperations  0xea8acf9c996a8d2725b92491633d993299a780b71712724f241c46bcf84dbc3d
ActivePool          0x48bf4ae29dbdacd5ab0387bb2b659e3f557893f3c88fd70e92a22949e91241cf
LUSDToken           0x21942bbe66179415d00053569e6378a03b1246b79f6049dd03862f77dbef09d5
PriceFeed           0xb70f04d5aebbef8d80e837eedc7afe66389fb295942e2df0dfe3921fb04d5627
SortedTroves        0x6a2f5d383cdb05c307491973d32b40fbe82ed6661d05bd921f5bfbe91adc709b
DefaultPool         0x81fb578e5b32edf596306b220c3da9d92573a44670a3ae1c2358a367605f234a
CollSurplusPool     0x33eb8e7c3f6eeb1010d50030042587b00646e341088696d372bd2bee29f44c59
GasPool             0x2bceb0660655904aabf649a45ee965bf58a6b919ed2b76fe7d4c4984e803b6b4
```

Direcciones mainnet de los contratos núcleo (de `mainnet.json`):

| contrato | dirección |
|---|---|
| `TroveManager` | `0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2` |
| `StabilityPool` | `0x66017D22b0f8556afDd19FC67041899Eb65a21bb` |
| `BorrowerOperations` | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` |
| `ActivePool` | `0xDf9Eb223bAFBE5c5271415C75aeCD68C21fE3D7F` |
| `DefaultPool` | `0x896a3F03176f05CFbb4f006BfCd8723F2B0D741C` |
| `CollSurplusPool` | `0x3D32e8b97Ed5881324241Cf03b2DA5E2EBcE5521` |
| `GasPool` | `0x9555b042F969E561855e5F28cB1230819149A8d9` |
| `LUSDToken` | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` |
| `PriceFeed` | `0x4c517D4e2C851CA76d7eC94B805269Df0f2201De` |
| `SortedTroves` | `0x8FdD3fbFEb32b28fb73555518f8b361bCeA741A6` |
| `HintHelpers` | `0xE84251b93D9524E0d2e621Ba7dc7cb3579F997C0` |
| `TellorCaller` | `0xAd430500ECDa11E38C9bCB08a702274b94641112` |

### 3.9 Auditoría del historial upstream: TODOS los fixes de seguridad posteriores al commit desplegado

Clon completo de `github.com/liquity/dev` (`git clone --filter=blob:none`, HEAD
`3e64ee1b52c50d51587c64c1cf75e0ba82934979`) y comparación de ancestros contra el commit
desplegado:

```
$ git log --oneline --no-merges 5174ecd..HEAD -- packages/contracts
$ git merge-base --is-ancestor <fix> 5174ecd
```

**Resultado: exactamente 7 commits de fix de seguridad posteriores NO están en producción.**

| commit | mensaje | en producción | veredicto |
|---|---|---|---|
| `b9dcdbd3` | contracts: Fix back to Normal Mode issue in multi-liquidations | **NO** | ⇒ **es C-1** (el primer intento de fix; `47fb4d56` lo corrige) |
| `47fb4d56` | contracts: Fix back to Normal Mode issue in multi-liquidations | **NO** | ⇒ **es C-1** (fix final: añade `.sub(collGasCompensation)`) |
| `7fea84a3` | fix: Prevent underflow in liquidations due to smalll offset | **NO** | **descartado** (ver abajo) |
| `0e32e8a0` | fix: Remove unused code from SP (offset debt never reaches total deposits) | **NO** | cosmético (simplifica el caso `_debtToOffset == _totalLUSDDeposits`) |
| `82e2a886` | fix: Make sure P cannot go below 1e9 | **NO** | **descartado** (ver abajo) |
| `288f500d` | fix: Better precision for 2 P scale changes | **NO** | **descartado** (ver abajo) |
| `800e820f` | fix: Make SP have min 1 BOLD | **NO** | **no aplica a v1** (refactor de la era BOLD v2; toca `LiquitySafeMath128`, `epoch`, `G`) |

#### 3.9.1 `7fea84a3` — underflow en liquidaciones por offset pequeño → **NO es crítico**

El fix añade `StabilityPool.getMaxAmountToOffset()` y evita que
`LUSDLossNumerator = _debtToOffset.mul(DECIMAL_PRECISION).sub(lastLUSDLossError_Offset)`
 underpase (SafeMath `.sub` **revierte** en Solidity 0.6.11).

Análisis matemático exacto (ver `audit/PoC_DeepProbe.js` y el modelo en el informe de
trabajo):

* `lastLUSDLossError_Offset` es el **resto** de la división, luego siempre cumple
  `0 ≤ lastLUSDLossError_Offset < totalLUSDDeposits`.
* El revert exige `debtToOffset·1e18 < lastLUSDLossError_Offset < T`
  ⇒ `debtToOffset < T/1e18`.
* Pero `debtToOffset = min(debt_del_trove, T − 1e18)` y `debt_del_trove ≥ MIN_NET_DEBT`
  = **1 800 LUSD = 1,8e21 wei** (`LiquityBase.MIN_NET_DEBT`).
* Para `T ≥ 1e18` (1 LUSD) el offset máximo es `T − 1e18`, y `(T−1e18)·1e18 ≥ T` para todo
  `T > 1e18` ⇒ **el offset máximo nunca produce underflow**.
* El underflow exigiría `debtToOffset < T/1e18 ≤ 1 000 wei` (¡milésimas de wei!) frente
  un mínimo de 1 800 LUSD.

⇒ **DoS teórico e inalcanzable**, y en cualquier caso un **revert**, no una extracción de
valor. **No cumple el criterio de crítico** (no hay `X → Y > X` para el atacante). El propio
comentario upstream referencia el PR #417 y admite que con `offset ≥ MIN_NET_DEBT` no ocurre.

#### 3.9.2 `82e2a886` + `288f500d` — la escala de `P` puede bajar de `SCALE_FACTOR` → **NO es crítico**

Producción (`StabilityPool.sol` L610-613):

```solidity
} else if (currentP.mul(newProductFactor).div(DECIMAL_PRECISION) < SCALE_FACTOR) {
    newP = currentP.mul(newProductFactor).mul(SCALE_FACTOR).div(DECIMAL_PRECISION);
    currentScale = currentScaleCached.add(1);        // <-- sólo +1
```

Con `DECIMAL_PRECISION = 1e18 = SCALE_FACTOR²` y `SCALE_FACTOR = 1e9`, se puede alcanzar un
`newP < 1e9` con `currentScale` incrementado **sólo en 1**, cuando la aritmética de
`_getCompoundedStakeFromSnapshots` (`d = d0·P/P(0)/SCALE^scaleDiff`, y `scaleDiff ≥ 2 ⇒ 0`)
asume `P ≥ SCALE_FACTOR`. El fix correcto sube la escala **dos** veces y recalcula `newP`
con `SCALE_FACTOR²`.

Modelado exacto (ver `audit/ACCOUNTING_...` y el modelo del informe): con `P = 1e12` y
`f = 1e5`, producción da `newP = 1e8` (escala 1) mientras el fix da `newP = 1e17` (escala 2),
es decir una discrepancia de **1e9×**.

**Por qué NO es crítico (y por qué NO es un robo de terceros):**

1. La pérdida la reparte **todo** el pool por igual: el mismo `P` y la misma `scale`
   aplican a todos los depositantes ⇒ **no hay transferencia de valor entre depositantes**,
   sólo una degradación del compounded deposit de *todos*.
2. Consecuencia práctica: `compoundedStake` puede caer por debajo del umbral
   `initialStake/1e9` ⇒ el depósito se vuelve retirable como 0 (el depositante pierde su
   LUSD) ⇒ es un **DoS/pérdida del pool**, no un enriquecimiento del atacante.
3. **No es permissionless-profitable**: para que el atacante ganase, tendría que ser un
   depositante del SP que *no* pierde; pero todos pierden igual.
4. El estado requerido (`P` entre 1e9 y 1e12 tras un offset) es alcanzable, pero el
   resultado es symmetric-loss, no `X → Y > X`.

⇒ **Descartado** como crítico; queda como **hygiene de precisión** (severidad media).

#### 3.9.3 Conclusión de la revisión del historial

De los **7** fixes de seguridad upstream no desplegados, **2 son C-1** (el mismo bug,
corregido en dos commits) y los otros **5** son: 1 cosmético, 1 refactor de la era BOLD (no
aplica a v1), y **3 que he descartado como críticos con modelado matemático explícito**
(1 DoS inalcanzable por `MIN_NET_DEBT`, 2 pérdida simétrica sin transferencia de valor).

**No hay un segundo 0-day de extracción de valor en el historial upstream pendiente de
desplegar.** El resto del core de Liquity v1 (ActivePool, DefaultPool, LUSDToken,
StabilityPool en sus rutas de depósito/retiro/compounding, BorrowerOperations,
SortedTroves, PriceFeed, HintHelpers, LQTY staking/issuance, LPRewards, CollSurplusPool,
GasPool) ha sido revisado y no presenta rutas de extracción de valor permissionless con PnL
positivo demostrable.

## 4. Fallback de ecosistema (activado por C-1 y ejecutado igualmente)

### 4.1 `liquity/ChickenBond` @ `b417bb74710d491c0e103c53c76f91ff36a2539f`

Contratos revisados: `ChickenBondManager.sol`, `BLUSDToken.sol`, `BondNFT.sol`,
`BLUSDLPZap.sol`, `ChickenMath.sol`.

Direcciones mainnet (`LUSDChickenBonds/addresses/mainnet.json`):

| Contrato | Dirección |
|---|---|
| `ChickenBondManager` | `0x6EA66D267234dC5ABfcC9885765a1e2E50073A2A` |
| `BLUSD` | `0xB9D7DdDca9a4AC480991865EfEf82E01273F79C3` |
| `BLUSDLPZap` | `0xcba8E52AB11b3209aB55E28622371d9877058d30` |
| AMM (`ChickenBondUniswapV2`/router) | `0x74ED5d42203806c8CDCf2F04Ca5F60DC777b901c` |

**Resultado: no crítico.** `mint`/`burn` de bLUSD restringidos al `ChickenBondManager`;
el `bondOwner` se verifica antes de redimir; el surplus, las fees y la contabilidad del
Y-token se conservan de forma consistente en `ChickenMath`. No se demostró ganancia
determinista por MEV/slippage; un ataque de slippage seguiría siendoPermissionless pero
depende de la concurrencia de mercados y no se reprodujo con PnL positivo reproducible.

### 4.2 `backstop-protocol/dev` @ `409ece756492f97197101c8266fdc025021caff6` — BAMM LUSD→Liquity SP

Contrato: `packages/contracts/contracts/B.Protocol/BAMM.sol`.

**Resultado: no crítico.** Verificación matemática del *share accounting*:

```
deposit():  newShare = total * lusdAmount / totalValue      (total, totalValue pre-deposito)
            post-deposito: total' = total + newShare = total*(totalValue+lusdAmount)/totalValue
            fracción del depositante = newShare/total' = lusdAmount/(totalValue+lusdAmount)  ✓ proporcional
withdraw(): lusdAmount = lusdValue * numShares / total      ✓ pro-rata
```

Además, en el Stability Pool de Liquity v1 los depositantes de LUSD **nunca ganan** LUSD
(`_computeRewardsPerUnitStaked` produce `LUSDLossPerUnitStaked`; el_gain_ es en ETH), por
lo que `lusdValue` del BAMM es monótono no-creciente y no hay drift de interés que
desalinee `total` frente a `totalValue`.

**Nota de integración relevante:** el BAMM deposita en el Stability Pool de Liquity, luego
**está expuesto a C-1**: su LUSD (y el de sus LP) puede ser usado en la liquidación espuria
descrita arriba. Esto **no crea un hallazgo nuevo**, pero agrava el impacto de C-1 porque
una LP de tercero (el AMM) puede ser la fuente del LUSD que financia el ataque.

### 4.3 `Threshold-USD/dev` @ `a5484b9738f660726cf8ece94e80bcd53924e91f`

Contiene un BAMM **THUSD**, no LUSD. No hay integración productiva con el core Liquity v1
de mainnet. Revisado por analogía: mismo `share accounting` que 4.2 (correcto) y sin
puente a Liquity v1 ⇒ **no crítico**.

### 4.4 `liquity/community-proxy-scripts` @ `febd7843bd5aa7da3778a47d7ff9838962a9787d`

Sin contratos (sólo scripts de despliegue). **No aplica.**

---

## 5. Registro de repositorios, configuraciones y artefactos inspeccionados

### 5.1 Repositorios y hashes

| # | Repo | Commit | Papel |
|---|---|---|---|
| 1 | `github.com/liquity/dev` | `5174ecd0da4842157aba989499200d690b7e374f` | **producción auditada** |
| 2 | `github.com/liquity/dev` (HEAD) | `3e64ee1b52c50d51587c64c1cf75e0ba82934979` | control "fixed" |
| 3 | `github.com/liquity/ChickenBond` | `b417bb74710d491c0e103c53c76f91ff36a2539f` | fallback |
| 4 | `github.com/Threshold-USD/dev` | `a5484b9738f660726cf8ece94e80bcd53924e91f` | fallback |
| 5 | `github.com/backstop-protocol/dev` | `409ece756492f97197101c8266fdc025021caff6` | fallback |
| 6 | `github.com/liquity/community-proxy-scripts` | `febd7843bd5aa7da3778a47d7ff9838962a9787d` | fallback (sin contratos) |

### 5.2 Configuraciones / genesis / deploy inspeccionados

- `packages/lib-ethers/deployments/default/mainnet.json` — `version`, `startBlock`, `deploymentDate`, mapa de direcciones.
- `packages/contracts/mainnetDeployment/mainnetDeploymentOutput.json` — direcciones y txHash de cada despliegue.
- `packages/contracts/mainnetDeployment/deploymentParams.mainnet.js` — parámetros de mainnet.
- `packages/contracts/mainnetDeployment/mainnetDeployment.js`, `mainnetRealDeployment.js`, `rinkebyDeployment.js`.
- `packages/contracts/mainnetDeployment/realDeploymentOutput/`, `rinkebyDeploymentOutput.json`, `balancerPoolDeployment.js`, `aaveEthOracleDeployment.js`.
- `packages/contracts/dev-chain/` — chainspec/config local sin RPC (usado para los PoCs).
- `packages/contracts/hardhat.config.js`, `hardhatAccountsList2k.js` — red local de pruebas.
- `packages/contracts/utils/deploymentHelpers.js`, `utils/testHelpers.js` — wiring y helpers (modificados temporalmente en el workspace de producción para compilar sin red).
- `packages/contracts/contracts/Dependencies/LiquityBase.sol` — constantes MCR/CCR/PERCENT_DIVISOR.
- `packages/contracts/contracts/Dependencies/LiquityMath.sol` — `_computeCR`, `_computeNominalCR`, `_min`.
- `packages/contracts/contracts/TroveManager.sol`, `StabilityPool.sol`, `BorrowerOperations.sol`, `LUSDToken.sol`, `ActivePool.sol`, `DefaultPool.sol`, `CollSurplusPool.sol`, `SortedTroves.sol`, `PriceFeed.sol`, `LQTY/*.sol`, `LPRewards/Unipool.sol`, `Proxy/*.sol`.
- `packages/contracts/contracts/Interfaces/*.sol` — para trazar el call graph real.
- No hay `Anchor.toml` / `Move.toml` / `genesis.json` en este stack (es un proyecto Solidity/JS; el equivalente es `dev-chain/` + `mainnetDeployment/`).

### 5.3 Tests / PoCs ejecutados (comandos y salidas)

| Comando | Resultado |
|---|---|
| `npx hardhat compile` (prod `5174ecd`) | 87 contratos compilados (solc 0.6.11 local vía `solc-local-plugin.js`) |
| `npx hardhat compile` (HEAD) | 86 contratos compilados |
| `npx hardhat test test/TroveManager_RecoveryModeTest.js` (prod) | `60 passing, 12 failing` — 12 fallos EIP-1559 resueltos con `gasPrice: 20000000000`; los 12 restantes son aserciones semánticas preexistentes del propio suite (comparan balances con gas / valores inconsistentes), **no** atribuibles a C-1 |
| `npx hardhat test test/PoC_batchTCRBug.js` (prod) | `✔ VICTIM trove with ICR >= real TCR is capped-liquidated; SP depositor gains 547250 USD` — carol status 3, dennis +2 961,22 ETH, erin +270,77 ETH; `1 failing` = el CONTROL (que exige el código corregido) |
| `npx hardhat test test/PoC_batchTCRBug.js` (HEAD corregido) | `✔ CONTROL` — carol status 1, atacante +12,88 ETH |
| `npx hardhat test test/PoC_liquidateTrovesTCRBug.js` (prod) | `✔ victim trove with ICR >= real TCR is capped-liquidated by liquidateTroves()` — carol status 3, atacante +4 065,29 ETH |
| `npx hardhat test test/PoC_liquidateTrovesTCRBug.js` (HEAD corregido) | VICTIM **falla** (victim status 1, atacante +156,36 ETH) ⇒ control diferencial |
| `npx hardhat test test/PoC_backToNormalMode.js` (prod) | `✔ after a capped liquidation the sequence still thinks it is in Recovery Mode` — carol status 3, atacante +4 065,29 ETH |
| `npx hardhat test test/Upstream_BatchRecovery_Test.js` (prod) | **`2 passing, 4 failing`**, incluidos *"A trove over TCR is not liquidated"* (-2 vs +1) y *"Stability Pool profit matches"* (SP ETH 36,815 en prod vs 21,89 esperado ⇒ **+14,925 ETH de más**, en el escenario propio de ese test) |
| `npx hardhat test test/Upstream_BatchRecovery_Test.js` (HEAD) | `5 passing, 1 failing` (el resto por `getMaxAmountToOffset`, no relacionado) |
| `npx hardhat test test/PoC_batchTCRBug_max.js` (prod) | `✔` — 10 liquidaciones (4 espurias), atacante **+781,79 ETH**, 4 víctimas con status `3` |
| `npx hardhat test test/PoC_batchTCRBug_max.js` (HEAD) | 6 liquidaciones, 4 víctimas con status `1`, atacante **+469,07 ETH** ⇒ delta espurio **+312,72 ETH** |
| `npx hardhat test test/PoC_thirdPartyProfit.js` (prod) | `✔` — 10 liquidaciones; `erin` (depositora de terceros, sin trove) **+196,998 ETH**; `dennis` **+584,787 ETH**; llamada a la liquidación hecha por un tercero |
| `npx hardhat test test/PoC_thirdPartyProfit.js` (HEAD) | 6 liquidaciones; `erin` +118,199 ETH; `dennis` +350,872 ETH; víctimas con status `1` y surplus `0` |

### 5.4 Reproducción

Ver `audit/README.md` (sección "Cómo reproducir") y los 4 PoCs en `audit/`:

- `audit/PoC_batchTCRBug.js` — batch, victimización básica + control
- `audit/PoC_batchTCRBug_max.js` — batch grande: el error de tracking se acumula (10 liquidaciones, +781,79 ETH)
- `audit/PoC_liquidateTrovesTCRBug.js` — ruta secuencial `liquidateTroves()`
- `audit/PoC_backToNormalMode.js` — el mismo tracker rompe `backToNormalMode`
- `audit/PoC_thirdPartyProfit.js` — la ganancia fluye a depositantes de terceros que no son el atacante
- `audit/Upstream_BatchRecovery_Test.js` (test del propio upstream, sin modificar)
- `audit/solc-local-plugin.js` (override de Hardhat para compilar sin `binaries.soliditylang.org`)

### 5.5 Repositorios bloqueados

- **Ninguno de los repositorios públicos** de `github.com/liquity` (37) quedó inaccesible:
  se enumeraron todos y se clonaron los relevantes para el stack desplegado.
- La API de GitHub no expone el número de repositorios privados de la organización
  (`public_repos=37`), por lo que **no se puede afirmar cobertura de repos privados**.
  No se observó ningún repo privado referenciado por el código de producción auditado.
- `github.com/llamafinance/b-protocol` **no existe** (404); el BAMM LUSD correcto está en
  `github.com/backstop-protocol/dev`.

---

## 5-bis. Búsqueda de un 0-day ADICIONAL (segunda ronda, tras C-1)

El encargo pedía buscar vulnerabilidades críticas **reales**. Tras encontrar C-1 se hizo una
segunda ronda específica para intentar un 0-day **más agresivo** (mayor impacto, o una vía
distinta). Resultado de esa ronda:

### 5-bis.1 Se recuperó el historial completo de `liquity/dev` y se enumeraron TODOS los fixes de seguridad posteriores al commit desplegado

Clon completo (`git clone --filter=blob:none`, HEAD `3e64ee1b…`) + comparación de ancestros:
**exactamente 7 commits de fix de seguridad** posteriores a `5174ecd` **no** están en producción.
Dos son C-1 (`b9dcdbd3` + `47fb4d56`, el mismo bug corregido en dos pasos); los otros cinco se
han **triado con modelado matemático explícito** (ver §3.9):

| commit | naturaleza | veredicto |
|---|---|---|
| `7fea84a3` | underflow en liquidaciones por offset pequeño | **DoS inalcanzable** (exige `debtToOffset < T/1e18 ≤ 1000 wei` frente a `MIN_NET_DEBT` = 1 800 LUSD); además es un *revert*, no extracción |
| `82e2a886` | `P` puede bajar de `SCALE_FACTOR` | **pérdida simétrica**: el mismo `P`/`scale` aplica a todos los depositantes ⇒ no hay transferencia de valor entre ellos; es pérdida del pool, no `X → Y > X` |
| `288f500d` | precisión del 2º cambio de escala | ídem (mismo defecto, fix de precisión) |
| `0e32e8a0` | código muerto en el offset del SP | cosmético |
| `800e820f` | "SP con mínimo 1 BOLD" | **no aplica a v1** (refactor de la era BOLD v2: `LiquitySafeMath128`, `epoch`, `G`) |

⇒ **No hay un segundo 0-day de extracción de valor pendiente de desplegar en el historial
upstream.**

### 5-bis.2 Fuzzer dirigido de extracción de valor (`audit/PoC_ValueExtractionFuzzer.js`)

8 estrategias **permissionless** (sin roles de admin ni keeper), cada una medida con la
**riqueza total** del actor (wallet ETH + LUSD + depósito compuesto en el SP + gain ETH
pendiente + valor del trove − su deuda) y con un **verificador de conservación de valor**
(la suma de la riqueza de todos los actores no puede aumentar ⇒ si aumenta, hay creación de
valor de la nada):

| # | estrategia | resultado medido |
|---|---|---|
| E1 | Recovery Mode, rama *capped* (C-1) | **atacante +255,67 ETH (+43 464 USD)** ← **el único con ganancia** |
| E2 | Recovery Mode, 100 % < ICR < MCR (offset + redistribución) | atacante **−594 540 ETH** (pierde) |
| E3 | Normal Mode, ICR < MCR | atacante **−49 545 ETH** (pierde) |
| E4 | Redención con hints (`HintHelpers`) | sin creación de valor (la fee de redención va al `LQTYStaking`, no al redentor) |
| E5 | `withdrawETHGainToTrove` | sin creación de valor (mueve el gain del SP a un trove propio) |
| E6 | `withdrawLUSD` / `repayLUSD` / `closeTrove` | `withdrawLUSD` = −6,25 ETH (la *borrowing fee*); `repayLUSD` = 0 neto; `closeTrove` sin anomalías |
| E7 | `withdrawColl` hasta el límite exacto de MCR | 0 (el guard `_requireICRisAboveMCR` + `_requireNewICRisAboveOldICR` bloquea) |
| E8 | `liquidate` + `redeem` en la misma tx (*flash* clásico) | +255,67 ETH = **exactamente C-1** (la redención no aporta nada) |

⇒ **El único camino que da dinero al atacante es C-1.** Ninguna otra ruta del core crea
valor.

### 5-bis.3 Teorema de cota del daño de C-1 (demostración por ramas)

En las tres ramas de `_liquidateRecoveryMode`, el error del tracker es **siempre positivo**
(el tracker queda por encima ⇒ **el TCR nunca se defla**):

| rama | coll que sale del ActivePool | lo que resta el tracker | error |
|---|---|---|---|
| I: ICR ≤ 100 % | `coll − gasComp` (redistribución) | `collToSendToSP` = 0 | `coll − gasComp` > 0 |
| II: 100 % < ICR < MCR | `coll − gasComp` | `collToSendToSP` | ≥ 0 |
| III: MCR ≤ ICR < TCR (*capped*) | `coll` (todo) | `collToSendToSP` | `coll − collToSendToSP` > 0 |

Consecuencias (todas medidas, §3.9 / PoC B3):

1. El error **infla**, nunca deflá ⇒ **no** existe la variante "liquidar troves con ICR < MCR"
   (que permitiría robar el trove entero en vez del premium).
2. Como el TCR efectivo **sube**, las víctimas son troves con ICR en `[MCR, TCR_real)`.
   Su ICR ≥ MCR ⇒ la rama aplicable es la *capped* ⇒ el robo se limita al **premium de
   liquidación al MCR = 9,45 % del debt** de la víctima, tomado de **su propio** collateral.
3. **Una** víctima por lote (el tracker inflado activa `backToNormalMode` y el resto se
   omiten).
4. Techo agregado: el **LUSD del Stability Pool** (third-party), que es lo que se quema.

⇒ **C-1 es la extracción máxima por esta vía**, y su impacto está acotado y medido.

### 5-bis.4 Superficies del core revisadas sin hallazgo de extracción

`ActivePool`, `DefaultPool`, `LUSDToken` (mint/burn/permit/blacklist), `GasPool`,
`CollSurplusPool`, `SortedTroves` (insert/remove/reInsert/`_validInsertPosition`/
`_findInsertPosition`), `HintHelpers`, `PriceFeed` (Chainlink + Tellor + fallback y los 4
estados de status), `BorrowerOperations` (open/adjust/withdraw/repay/close + los guards de
ICR/TCR/MCR/CCR), `TroveManager` (redistribución, `L_ETH`/`L_LUSDDebt`, snapshots de
recompensa, `_computeNewStake`, `_getRedemptionFee`/`baseRate`, `_getBorrowingFee`),
`StabilityPool` (compounding `P`/`S`/`G` con sus offsets de error, `provideToSP`,
`withdrawFromSP`, `withdrawETHGainToTrove`, `offset`, `_updateRewardSumAndProduct`),
`LQTYStaking`, `LQTYToken`, `CommunityIssuance`, `LockupContract`/`LockupContractFactory`,
`LPRewards/Unipool`.

### 5-bis.5 Prueba de que el código auditado ES el desplegado

Ver §3.8: `version` = commit auditado; 14 logs de despliegue que prueban que los contratos
**nunca** se redeployaron; Etherscan "Source Code Verified — **Exact Match**" con
`v0.6.11+commit.5ef660b1` y "100 runs"; contratos **sin proxy** y **sin proxy de
actualización**; el Stability Pool sigue en uso activo (42 087 transacciones, actividad 1 h
antes de la consulta).

## 6. Conclusión

**Sí existe una vulnerabilidad crítica en el código clonado y en la ruta productiva**
(commit `5174ecd0da4842157aba989499200d690b7e374f`, desplegado en mainnet el
2021-04-05): el tracker `entireSystemColl` de `TroveManager.sol` no resta todo el
collateral que sale del sistema en las liquidaciones en modo Recovery (L722 en la ruta
batch; L583 en la secuencial), lo que **infla el TCR**, habilita liquidar troves cuyo ICR
es **superior** al TCR real mediante la rama *capped*, y transfiere el ~10 % del debt de
la víctima al Stability Pool — de donde el atacante (y cualquier otro depositante del
SP) lo retira. Permissionless, con **549 439 USD** capturados por el Stability Pool en un
lote de dos troves (y **781,79 ETH** en un lote de diez), y con el fix
upstream **no desplegado**.

Fuera de ese punto, el core de Liquity v1 y los protocolos del ecosistema integrados
revisados (ChickenBond, BAMM LUSD de B.Protocol, BAMM THUSD de Threshold) **no presentan
vulnerabilidades críticas** que cumplan los cuatro criterios exigidos.

---

# Parte II — Auditoría de Bumpin Trade (segundo objetivo)

Programa on-chain `bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2` ("Bumpin Trade Program"),
Solana mainnet-beta. TVL verificado **3 804 239,70 USD** (DefiLlama).
Informe completo: [`bumpin/REPORT.md`](bumpin/REPORT.md).

## Veredicto: **no crítico demostrado**

El **código fuente del programa es privado**. Los 3 repos públicos de
`github.com/bumpin-exchange` (`explorer`, `assets`, `rocketmq-clients`) **no contienen el
programa**; la búsqueda de código en GitHub de `bumpin_trade`,
`collect_long_open_position_fee` y del program id devuelve **sólo copias del IDL**. El
binario desplegado (1 978 333 B de BPF) **no tiene verified build** y el programa **no
tiene `security.txt`** (ambas cosas confirmadas literalmente por el Solana Explorer).
Además, **no hay RPC disponible** en el entorno: los 8 endpoints RPC públicos probados
responden `SSL_ERROR_SYSCALL`, y `fetch_page` (que sí alcanza esos hosts) sólo admite
GET, mientras que Solana RPC exige POST.

Por tanto **no existe reimplementación local posible** y ningún PoC ejecutable. Reportar
un "crítico" exigiría especular sobre lógica interna no observable, lo que el encargo
prohíbe. **No se reporta ningún crítico.**

## Lo que sí se verificó sin RPC (y sostiene el veredicto)

1. **IDL on-chain completo** (`idl.solana.com`, 23 chunks). Validado: los layouts
   calculados con reglas Rust `repr(C)`+bytemuck **coinciden exactamente** con los
   tamaños de cuenta observados on-chain — `User` 7 608 B, `State` 376 B, `Pool` 568 B,
   `TradeToken` 216 B (Δ = 0 en todos). El IDL **es** byte-exacto para el binario vivo.
2. **Mapa de PDAs** derivado localmente y **verificado contra una tx real de mainnet**
   (`NvPnMH5c…`, `place_portfolio_order`, slot 461 403 966): `state`, `pool_1`,
   `pool_spl_token_0`, `pool_vault_0`, `rewards_0`, `trade_token_0`,
   `trade_token_vault_0` — 7/7 coincidencias. Detalle no trivial: las semillas numéricas
   se codifican **u16 little-endian**, no UTF-8 (con UTF-8 las PDAs no existen).
3. **Cuentas de producción decodificadas**: `State` (MMR 1 %, min margin $50, discount de
   referral 9 %, `max_profit_leverage` 200 000), `Pool` 0/1/2 (dual-pool: estable USDC
   `stable=true` con 74 mercados; base wSOL con 60 y 13), `TradeToken` USDC (99 % de
   descuento, factor de liquidación 0,5 %, ShadowStorm), `Market` 60 y 72
   (`share_short=true`, `stable_loss=0`), `Rewards` 0.
4. **Reconciliación contable**: `TradeToken.total_amount` (1 878 732 899) == balance real
   de `trade_token_vault_0` (1 878,732899 USDC) ⇒ **Δ = 0**. El tracker de depósitos
   cuadra: no hay aquí un análogo del C-1 de Liquity.
5. **Flujo de `collect_rewards` trazado tx a tx** (`2w7iqKPyXna…`, 2026-02-09): deltas
   USDC por cuenta.

## Hallazgos (ninguno cumple los 4 criterios de crítico)

| id | sev. | título | por qué no es crítico |
|---|---|---|---|
| H-1 | **Alta** | 3,8 M USD bajo una única EOA upgradeable (`CSjrvxqcMDpW8eZELyHTFkEN7a3HVHuiY9k2SpjiyC2w` = `State.admin` = upgrade authority), 4 upgrades en 10 meses, sin verified build, sin security.txt | es un **check de privilegio real**, excluido por el encargo |
| H-2 | Media | `pool_un_claim_amount` = 7 879,89 USDC sin respaldo (`pool_rewards_vault_0` = 0) y > `pool_vault_0` = 800,30 ⇒ **DoS de cobro de recompensas**; la porción DAO va a una **EOA** externa | no hay ruta de `X → Y > X` a costa de terceros; es atasco de función |
| H-3 | Media | IDL on-chain con `address` = `94bfdkcc…` ≠ programa desplegado (el Explorer lo marca "potentially fraudulent IDL"); 2 cuentas del programa (8 184 B y 9 012 B) **no decodificables** ⇒ superficie de *stake*/*positions* no auditable | opacidad, no exploit |
| H-4 | Media | Audit CertiK de ene-2025 (44 hallazgos, 0 críticos, 17 "Acknowledged") contra binario vivo de ene-2026 | desfase de información |

## Línea de investigación prioritaria (no demostrable sin fuente)

La **doc del propio IDL** distingue `Pool.fee_reward.fee_amount` — *"fees generated from
staking, redeeming, and position operations… **used in isolated margin mode** (since fees
are **actually transferred** each time they are generated)"* — de
`un_settle_fee_amount` — *"accounting for fees generated from **cross-margin** position
operations"*. Si la ruta cross-margin **sumara ambas** al distribuir, un operador de
cross-margin podría acuñar fees de la nada. Es el análogo más directo del C-1 de Liquity
(contadores de fees físicos vs contables). **No se reporta como crítico** porque exigiría
demostrar el bug en código de producción y aportar un PoC con PnL positivo, y no hay
fuente para ninguna de las dos cosas.

## Repos bloqueados (cobertura NO declarada completa)

1. **Código fuente del programa Bumpin** — no existe repo público.
2. **PDF del informe CertiK** — requiere login ⇒ los 4 *High* no son legibles en detalle.
3. **Cuentas con sub-structs anidados** (`Pool.balance`, `Pool.config`, `Market.config`,
   `User.tokens[]`, `User.positions[]`) — legibles sólo vía RPC POST, no disponible.
