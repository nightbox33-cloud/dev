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

| # | Severidad | Componente | Ubicación | Permisionless | PnL del atacante |
|---|---|---|---|---|---|
| C-1 | **CRÍTICA** | `TroveManager.sol` (core mainnet) | `packages/contracts/contracts/TroveManager.sol` L722 (batch) y L583 (secuencial) | **Sí** | **+2 961 ETH (503 408 USD)** para el atacante y **+3 231,99 ETH (549 439 USD)** capturados por el Stability Pool en un lote de 2; **+781,79 ETH** en un lote de 10. La ganancia se reparte pro-rata a **todos** los depositantes del SP |

**Resultado del resto del stack audited: no crítico.** No se halló ningún otro defecto que
cumpla los cuatro criterios exigidos (bug en código de producción + permissionless +
ruta/call-graph/config real + PoC con `X → Y > X` sobre fondos de terceros).

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
