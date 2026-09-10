// Run from frontend: node tests/event-finance.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/eventFinance.ts'), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}});
const mod = {exports: {}};
new Function('exports', 'module', compiled.outputText)(mod.exports, mod);
const calc = mod.exports.calculateEventFinance;
assert.deepEqual(calc(90,35,12,900,4), {subtotal:3150,discount:378,gross:2772,net:2253.66,vat:518.34,costs:900,profit:1872,paidPeople:35,freeCarers:4,attendees:39});
assert.equal(calc(90,35,12,900,0).gross,2772);
assert.equal(calc(90,35,100,900,4).gross,0);
assert.equal(calc(90,35,100,900,4).profit,-900);
assert.equal(calc('0,05',1,10,0,0).gross,.04);
for (const args of [[-1,35,12,0,0],[90,1.5,0,0,0],[90,35,101,0,0],[90,35,0,-1,0],['NaN',1,0,0,0],['1.001',1,0,0,0]]) assert.throws(() => calc(...args));
console.log('Frontend finance: all assertions passed');
