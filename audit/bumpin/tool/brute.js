const { PublicKey } = require('@solana/web3.js');
const PROGRAM = new PublicKey('bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2');
const TARGET = 'HMYpk4mG7VwHAs1KtEJSBmJqBseqfkNqyBth6KLD6U5c';
const prefixes = ['market','bump_market','market_pda','bumpin_market','markets','m'];
const idxs = [72];
const encs = {
  le2: i=>{const b=Buffer.alloc(2);b.writeUInt16LE(i);return b;},
  be2: i=>{const b=Buffer.alloc(2);b.writeUInt16BE(i);return b;},
  le8: i=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(i));return b;},
  str: i=>Buffer.from(String(i),'utf8'),
};
let found=[];
for(const p of prefixes) for(const [en,ef] of Object.entries(encs)) for(const i of idxs){
  try{
    const pk = PublicKey.findProgramAddressSync([Buffer.from(p,'utf8'), ef(i)], PROGRAM)[0].toBase58();
    if(pk===TARGET) found.push(`${p}/${en}/${i}`);
  }catch(e){}
}
// also single-seed and 3-seed variants
for(const p of prefixes) for(const [en,ef] of Object.entries(encs)) for(const i of idxs){
  const cands = [[Buffer.from(p,'utf8'), ef(i)],
                 [Buffer.from(p,'utf8'), ef(i), Buffer.from(p,'utf8')]];
  for(const seeds of cands){
    try{ const pk=PublicKey.findProgramAddressSync(seeds, PROGRAM)[0].toBase58();
      if(pk===TARGET) found.push(`${p}/${en}/${i}/seeds=${seeds.length}`);
    }catch(e){}
  }
}
console.log(found.length? found.join('\n') : 'NOT FOUND with those patterns');
// Brute: maybe seed is ["market", u16] but program id differs (older program 94bfdkcc...)
const OLD = new PublicKey('94bfdkcc7cBfucpWKQb9X1ftQFfvLp7eXo2iLRemd89Q');
let f2=[];
for(const p of prefixes) for(const [en,ef] of Object.entries(encs)) for(const i of idxs){
  try{ const pk=PublicKey.findProgramAddressSync([Buffer.from(p,'utf8'), ef(i)], OLD)[0].toBase58();
    if(pk===TARGET) f2.push(`OLD ${p}/${en}/${i}`);
  }catch(e){}
}
console.log(f2.length? f2.join('\n') : 'not OLD either');
