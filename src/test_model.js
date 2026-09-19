// node smoke test for model.js (new Sim API)
const fs = require('fs'), vm = require('vm'), path = require('path');
// ml-matrix UMD: fetch from https://cdn.jsdelivr.net/npm/ml-matrix@6.11.1/matrix.umd.js (or set MLMATRIX_UMD)
const mlmatrixPath = process.env.MLMATRIX_UMD || path.join(__dirname, 'mlmatrix.umd.js');
vm.runInThisContext(fs.readFileSync(mlmatrixPath, 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'model.js'), 'utf8'));
const M = globalThis.ChatterModel;
const p = M.defaultParams();
const line = new M.Line(p);
console.log('default: zeta', p.zeta, 'K', p.K);
line.op.forEach((o, i) => console.log(`s${i+1} P=${(o.P0/9806.65).toFixed(0)}t f=${(o.f0*100).toFixed(2)}% Rp/R=${(o.Rp0/o.R).toFixed(2)} kbar=${o.kbar.toFixed(0)} ks=${(o.ks/1e9).toFixed(1)} skid=${o.skid}`));
console.log('modes s1:', line.modes[0].map(m => m.f.toFixed(0) + 'Hz ' + m.kind).join(' | '));
const ea = M.eigenAnalysis(line, { fmin: 5 });
console.log('eig @1000:', ea.critical.f.toFixed(0), 'Hz Re', ea.critical.re.toFixed(2));
function crit(q) { let lo=60, hi=3000; const f=v=>M.eigenAnalysis(new M.Line({...q, vExit:v}),{fmin:5}).maxRe; if(f(lo)>0) return lo; if(f(hi)<0) return hi; for(let i=0;i<12;i++){const m=(lo+hi)/2; if(f(m)>0) hi=m; else lo=m;} return (lo+hi)/2; }
console.log('crit 4Hi', crit(p).toFixed(0), ' 6Hi', crit({...p, standTypes: Array(5).fill('6Hi')}).toFixed(0));
// presets
const presets = {
  tinplate: {...p, h0: 1.8, h: [1.15, 0.72, 0.45, 0.29, 0.22], sigma: [50, 150, 180, 200, 200, 60], vExit: 1600, mu: [0.030, 0.028, 0.026, 0.024, 0.022], standTypes: Array(5).fill('6Hi'), width: 900},
  thick: {...p, h0: 3.2, h: [2.3, 1.65, 1.2, 0.92, 0.8], sigma: [30, 90, 100, 110, 110, 40], vExit: 600, width: 1250},
};
for (const [k, q] of Object.entries(presets)) {
  const L = new M.Line(q); const e = M.eigenAnalysis(L, {fmin:5});
  console.log(k, 'P=', L.op.map(o => (o.P0/9806.65).toFixed(0)).join('/'), 'f%=', L.op.map(o => (o.f0*100).toFixed(1)).join('/'), 'skid=', L.op.map(o=>o.skid?1:0).join(''), 'eig', e.critical.f.toFixed(0), 'Hz Re', e.critical.re.toFixed(1), 'crit', crit(q).toFixed(0));
}
// sim: NaN injection → break
{
  const S = new M.Sim(new M.Line(p), { delay: true });
  S.advance(200); S.y[0] = NaN; S.advance(50);
  console.log('NaN inject → breaks', S.breaks, 'finite', isFinite(S.y[0]));
}
// sim: high speed huge breakAmp → no NaN
{
  const S = new M.Sim(new M.Line({...p, vExit: 1800}), { delay: true, breakAmp: 1e9 });
  S.advance(20000);
  let bad = false; for (let i = 0; i < S.y.length; i++) if (!isFinite(S.y[i])) bad = true;
  const g = S.window(S.chan.gauge[2], 4000); let mx = 0; for (const v of g) mx = Math.max(mx, Math.abs(v));
  console.log('breakAmp=inf 1 s @1800: finite=', !bad, 'max gauge µm', mx.toFixed(0), 'breaks', S.breaks);
}
// timing
{
  const S = new M.Sim(new M.Line(p), { delay: true });
  const t0 = Date.now(); S.advance(40000); console.log('µs/step', ((Date.now()-t0)/40000*1000).toFixed(1));
  const sp = M.spectrum(S.window(S.chan.gauge[2], 8192), 8192, S.fs, 8192, 800); console.log('spectrum peak', sp.peakF.toFixed(0), 'Hz', 'bins', sp.mag.length, 'finite', isFinite(sp.mag[10]));
  const sp0 = M.spectrum(new Float32Array(1), 1, S.fs, 8192, 800); console.log('spectrum count=1 finite:', isFinite(sp0.mag[3]));
}
