# Herramientas de verificación (Bumpin Trade)

Sin RPC en el sandbox. Toda la verificación se hizo contra:
- el IDL on-chain de `idl.solana.com` (23 chunks),
- páginas renderizadas server-side del Solana Explorer (`/anchor-account`, `/tx`, `/tokens`),
- y transacciones reales de mainnet.

## `pdas3.js` — derivación de PDAs y validación contra cuentas observadas
```
node pdas3.js
trade_token_0 LE = hHbkzFawXs2gu3CCFvfAqvPpoRY1WxpP42pj6dgaf8R  (== observado en tx NvPnMH5c…)
trade_token_vault_0 LE = 9E6twPbdM3oEAkzQaapg2mo5XKZCJ2MJUwD5aQNBUtS2 (== observado)
pool_0 LE = 6nUVAcC53y7G6wFUCDzdkFwNSziXaziNQwLj5RUCjc98 (== observado)
pool_1 LE = HKuLjGCNXaWZDyurbBY7z6Kr1tKKrxh79VvUw2uMHzfb (== observado)
```
**Nota**: las semillas numéricas se codifican como **u16 little-endian**, NO como UTF-8.
Con UTF-8 las PDAs no existen (error silencioso).

## `brute.js` — PDA de `market`
```
node brute.js
market/le2/72  → HMYpk4mG7VwHAs1KtEJSBmJqBseqfkNqyBth6KLD6U5c  (== observado en tx NvPnMH5c…)
```

## `sizes.js` — layout Rust `repr(C)` + bytemuck vs tamaño de cuenta observado
```
node sizes.js
State (IDL chunk 20) layout = 368 -> +8 = 376 ; OBSERVED = 376 ; delta = 0
User  (IDL) layout = 7600 -> +8 = 7608 ; OBSERVED = 7608 ; delta = 0
```

## `final_pdas.js` — mapa completo de PDAs → `pdas_final.json`

## Reproducir

```bash
cd audit/bumpin/tool
npm install          # sólo @solana/web3.js (npmjs.org está permitido en el sandbox)
npm run verify       # pdas3.js + brute.js + sizes.js
npm run pdas         # regenera pdas_final.json
```
Salida esperada de `npm run verify`:
```
trade_token_0 LE = hHbkzFawXs2gu3CCFvfAqvPpoRY1WxpP42pj6dgaf8R  (== observado en tx)
trade_token_vault_0 LE = 9E6twPbdM3oEAkzQaapg2mo5XKZCJ2MJUwD5aQNBUtS2 (== observado)
pool_0 LE = 6nUVAcC53y7G6wFUCDzdkFwNSziXaziNQwLj5RUCjc98 (== observado)
pool_1 LE = HKuLjGCNXaWZDyurbBY7z6Kr1tKKrxh79VvUw2uMHzfb (== observado)
---
market/le2/72  → HMYpk4mG7VwHAs1KtEJSBmJqBseqfkNqyBth6KLD6U5c  (== observado)
---
State (IDL chunk 20) layout = 368 -> +8 = 376 ; OBSERVED = 376 ; delta = 0
User  (IDL) layout = 7600 -> +8 = 7608 ; OBSERVED = 7608 ; delta = 0
Market layout = 600 -> +8 = 608 ; OBSERVED = 616
```
