# Registro de verificación final (ejecuciones reales)

Comandos ejecutados en `/tmp/prodws/packages/contracts` (código de **producción**
`5174ecd0da4842157aba989499200d690b7e29faAbCf4bb2`) y en `/tmp/fixedws/packages/contracts`
(**upstream corregido**, tracker con `.sub(collGasCompensation).sub(collSurplus)`).

```
$ npx hardhat test test/<PoC>.js --network hardhat
```

## Código de PRODUCCIÓN (5174ecd) — el bug se reproduce

| PoC | resultado | qué demuestra |
|---|---|---|
| `PoC_NetPnL.js` | **1 passing** | PnL NETO del atacante **+255,67 ETH (+43 464 USD)**; la víctima queda liquidada (status 3) |
| `PoC_SequentialNetPnL.js` | **1 passing** | PnL NETO en la ruta secuencial **+257 ETH (+43 749 USD)** |
| `PoC_SequentialMultiVictim.js` | **4 passing** | con N=1,2,3 víctimas ⇒ **1 capturada por secuencia** en los tres casos |
| `PoC_ValueExtractionFuzzer.js` | **8 passing** | 8 estrategias permissionless; sólo E1 (C-1) da ganancia; el verificador de conservación de valor no detecta creación de valor en ninguna |
| `PoC_batchTCRBug.js` | **1 passing, 1 failing** | el "failing" es el **CONTROL**, que exige el código corregido (falla a propósito en producción) |
| `PoC_liquidateTrovesTCRBug.js` | **1 passing** | ruta secuencial: atacante +4 065,29 ETH en producción |
| `PoC_backToNormalMode.js` | **1 passing** | el tracker inflado también rompe la salida de Recovery Mode |
| `PoC_batchTCRBug_max.js` | **1 passing** | lote de 10: producción 10 liquidaciones / +781,79 ETH vs corregido 6 / +469,07 ETH |
| `PoC_thirdPartyProfit.js` | **1 passing** | una depositaria **sin trove** también se lucra (los fondos capturados son de terceros) |

## Código UPSTREAM CORREGIDO — el bug desaparece (control diferencial)

| PoC | resultado | qué demuestra |
|---|---|---|
| `PoC_NetPnL.js` | **0 passing, 1 failing** | la aserción *"la victima debe estar liquidada"* **falla** ⇒ en el código corregido la víctima **sobrevive** |
| `PoC_SequentialMultiVictim.js` | **4 passing** | **0 víctimas capturadas** en N=1,2,3 (frente a 1 en producción) |
| `PoC_batchTCRBug.js` | **1 passing, 1 failing** | el **CONTROL pasa** (la víctima sobrevive, atacante ≤ 13 ETH) y el test principal falla (no hay liquidación espuria) |
| `PoC_batchTCRBug_max.js` | **1 passing** | 6 liquidaciones / +469,07 ETH (todo legítimo) |

## Diferencial limpio
`PoC_NetPnL` pasa en producción y **falla** en el corregido; `PoC_batchTCRBug` se comporta al
revés (su CONTROL exige lo contrario). Es el criterio de **prueba diferencial** aplicado a los
dos lados, tal como exige el encargo.

## Cifras clave medidas (no estimadas)

```
PROD batch        : atacante +255,67 ETH  (+43 464 USD)   victim liquidada (status 3)
PROD secuencial   : atacante +257 ETH     (+43 749 USD)   victim liquidada (status 3)
UPSTREAM corregido: atacante +1,01 ETH    (+172 USD)      victim INTACTA (status 1)
Δ espurio         : +254,66 ETH           (+43 292 USD)

SP ETH  : PROD 270,77 ETH (batch) / 272,55 (secuencial)   vs  UPSTREAM 10,79 ETH
SP LUSD : PROD 596 814,92 -> 91 514,92                     vs  UPSTREAM 596 814,92 -> 49 832,44
Victim : coll surplus 764,71 ETH a su favor (el atacante NO puede reclamarlo)
Límite : 1 víctima por lote/secuencia (medido con N=1,2,3)
Techo  : el LUSD del Stability Pool
```

## Identidad del código desplegado

```
mainnet.json version = 5174ecd0da4842157aba989499200d690b7e374f
14/14 logs de despliegue: "Using previously deployed troveManager contract at
  0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2" + "already verified"
Etherscan 0xA39739EF...: "Source Code Verified - Exact Match"
  compiler v0.6.11+commit.5ef660b1 | optimizer 100 runs | sin proxy
```

## Comandos de apoyo

```
git clone --filter=blob:none https://github.com/liquity/dev.git /tmp/liq
git log --oneline --no-merges 5174ecd..HEAD -- packages/contracts
git merge-base --is-ancestor <fix> 5174ecd        # => exit != 0 = NO desplegado
git archive 5174ecd packages/contracts | tar -x -C /tmp/prodws
npx hardhat compile                                # 87 contratos en producción
node -e "…keccak256(deployedBytecode)…"            # hashes de runtime
```
