# Auditoría Bumpin Trade

Auditoría del programa on-chain `bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2`
(Bumpin Trade Program, Solana mainnet-beta). TVL verificado **3 804 239,70 USD**.

## Documentos
| fichero | contenido |
|---|---|
| **`REPORT.md`** | **Informe final**: veredicto, cobertura, config de producción verificada, reconciliación contable, hallazgos H-1..H-4, candidatos descartados, registro final (repos/comandos/bloqueados) |
| `IDL_SUMMARY.md` | IDL on-chain reconstruido: mapa de PDAs, superficie de instrucciones, matriz de permisos, structs y params, errores 6000-6109 |
| `ONCHAIN_STATE.md` | Estado on-chain decodificado y verificado: `State`, `Pool`×3, `TradeToken`, `Market`×2, `Rewards`, balances reales, flujo de `collect_rewards` |
| `ACCOUNTING_MODEL.md` | Modelo contable reconstruido (dual-pool, `PoolBalance`, `FeeReward`, `MarketConfig`) + 10 invariantes candidatos a bug |
| `tool/` | Scripts Node de verificación (derivación de PDAs, layout `repr(C)`, brute-force de seeds) con `tool/README.md` |

## Veredicto
**No crítico demostrado.** El código fuente del programa es **privado**, el binario no tiene
**verified build** ni **security.txt**, y no hay RPC en el entorno ⇒ no hay reimplementación
local posible ni PoC ejecutable. Se reportan **H-1 (Alta, centralización)**, **H-2 (Media,
DoS de recompensas)**, **H-3 (Media, opacidad del IDL)**, **H-4 (Media, desfase del audit)**.

## Cómo se verificó sin RPC
1. **IDL on-chain** de `idl.solana.com` (23 chunks) — **layouts calculados = tamaños observados
   on-chain, delta 0** (`User` 7 608 B, `State` 376 B, `Pool` 568 B, `TradeToken` 216 B).
2. **PDAs derivadas localmente** y **verificadas contra una tx real de mainnet**
   (`NvPnMH5cSJCLsvYjyg3mzw1o1jDsFpAsYzogFeTz8WJ4x25V8BzAnmF6fduc7AJeAju4zcXJYB6jSXYW1wgXYnS`).
3. **Cuentas decodificadas** vía la vista `/anchor-account` del Solana Explorer (server-side).
4. **Balances reales** de las token accounts, reconciliados contra los contadores del programa.
5. **Flujo de `collect_rewards`** desglosado tx a tx (`2w7iqKPyXna…`).

## Advertencia sobre las semillas de PDA
Las semillas numéricas se codifican como **u16 little-endian**, no como UTF-8.
Con UTF-8 las PDAs de `pool`/`market`/`trade_token` **no existen** (fallo silencioso).
