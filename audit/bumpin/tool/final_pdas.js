const { PublicKey } = require('@solana/web3.js');
const fs=require('fs');
const PROGRAM = new PublicKey('bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2');
const f=(p,i)=>{const b=Buffer.alloc(2);b.writeUInt16LE(i);
  return PublicKey.findProgramAddressSync([Buffer.from(p,'utf8'),b],PROGRAM)[0].toBase58();};
const out={};
for(let i=0;i<=80;i++) out['market_'+i]=f('market',i);
for(let i=0;i<=6;i++) out['pool_'+i]=f('pool',i);
for(let i=0;i<=6;i++) out['pool_vault_'+i]=f('pool_vault',i);
for(let i=0;i<=14;i++) out['trade_token_'+i]=f('trade_token',i);
for(let i=0;i<=14;i++) out['trade_token_vault_'+i]=f('trade_token_vault',i);
fs.writeFileSync('pdas_final.json', JSON.stringify(out,null,1));
// print markets 60..79 (pool1 has 60 markets, pool0 has 74)
for(let i=60;i<=79;i++) console.log('market',i,out['market_'+i]);
