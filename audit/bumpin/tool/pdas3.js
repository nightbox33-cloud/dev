const { PublicKey } = require('@solana/web3.js');
const PROGRAM = new PublicKey('bumpinX5wdLt59DBR3eetmV6xB2W3rNGxMoTSc58ah2');
function findU16(seeds, idx, le=true){
  const b = Buffer.alloc(2); le ? b.writeUInt16LE(idx) : b.writeUInt16BE(idx);
  return PublicKey.findProgramAddressSync([...seeds.map(s=>Buffer.from(s,'utf8')), b], PROGRAM)[0].toBase58();
}
// verify trade_token_0 == hHbkzFawXs2gu3CCFvfAqvPpoRY1WxpP42pj6dgaf8R
console.log('trade_token_0 LE =', findU16(['trade_token'],0), '(expect hHbkzFawXs2gu3CCFvfAqvPpoRY1WxpP42pj6dgaf8R)');
console.log('trade_token_vault_0 LE =', findU16(['trade_token_vault'],0), '(expect 9E6twPbdM3oEAkzQaapg2mo5XKZCJ2MJUwD5aQNBUtS2)');
console.log('pool_0 LE =', findU16(['pool'],0), '(expect 6nUVAcC53y7G6wFUCDzdkFwNSziXaziNQwLj5RUCjc98)');
console.log('pool_1 LE =', findU16(['pool'],1), '(expect HKuLjGCNXaWZDyurbBY7z6Kr1tKKrxh79VvUw2uMHzfb)');
// markets LE and BE
for (const [tag,le] of [['LE',true],['BE',false]]) {
  console.log(`--- market seeds ${tag} ---`);
  for(let i=0;i<8;i++) process.stdout.write(`${i}:${findU16(['market'],i,le)}  `);
  console.log();
}
