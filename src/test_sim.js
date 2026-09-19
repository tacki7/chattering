const fs = require('fs'), vm = require('vm'), path = require('path');
// ml-matrix UMD: fetch from https://cdn.jsdelivr.net/npm/ml-matrix@6.11.1/matrix.umd.js (or set MLMATRIX_UMD)
const mlmatrixPath = process.env.MLMATRIX_UMD || path.join(__dirname, 'mlmatrix.umd.js');
vm.runInThisContext(fs.readFileSync(mlmatrixPath, 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'model.js'), 'utf8'));
const M = globalThis.ChatterModel;
const p = M.defaultParams();

// critical speed by bisection (eigen based)
function critSpeed(q) {
  let lo = 50, hi = 3000;
  const f = v => M.eigenAnalysis(new M.Line({ ...q, vExit: v }), { fmin: 5 }).maxRe;
  if (f(lo) > 0) return lo; if (f(hi) < 0) return hi;
  for (let i = 0; i < 14; i++) { const m = 0.5 * (lo + hi); if (f(m) > 0) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}
for (const z of [0.06, 0.08, 0.10, 0.12, 0.15]) {
  const t0 = Date.now();
  const c4 = critSpeed({ ...p, zeta: z });
  const c6 = critSpeed({ ...p, zeta: z, standTypes: ['6Hi','6Hi','6Hi','6Hi','6Hi'] });
  console.log(`zeta=${z}: crit 4Hi=${c4.toFixed(0)} m/min, 6Hi=${c6.toFixed(0)} m/min  (${Date.now()-t0} ms)`);
}
// sensitivity: L, kHouse, tension
const z = 0.10;
for (const L of [3000, 4500, 6000]) console.log(`L=${L}: crit=${critSpeed({...p, zeta:z, Lgap:L}).toFixed(0)}`);
for (const kh of [6, 12, 24]) console.log(`kHouse=${kh}: crit=${critSpeed({...p, zeta:z, kHouse:kh}).toFixed(0)}`);
for (const ms of [0.6, 1.0, 1.4]) console.log(`mu x${ms}: crit=${critSpeed({...p, zeta:z, mu:p.mu.map(m=>m*ms)}).toFixed(0)}`);
for (const ts of [0.6, 1.0, 1.4]) console.log(`tension x${ts}: crit=${critSpeed({...p, zeta:z, sigma:p.sigma.map(s=>s*ts)}).toFixed(0)}`);

// continuous sim with rebind
function run(q, secs, delay, tag) {
  const L = new M.Line(q);
  const S = new M.Sim(L, { delay, noise: 2000, histSec: 3 });
  S.kick(2, 0.001);
  const t0 = Date.now();
  const steps = Math.round(secs / S.dt);
  const broke = S.advance(steps);
  const ms = Date.now() - t0;
  const out = [];
  for (let i = 0; i < 5; i++) {
    const g = S.window(S.chan.gauge[i], Math.min(S.count, 40000));
    let mx = 0; for (const v of g) mx = Math.max(mx, Math.abs(v));
    const sp = M.spectrum(g, g.length, S.fs, 16384, 1000);
    const gr = M.growthRate(g, g.length, S.fs, 0.2, g.length / S.fs);
    out.push(`s${i+1}:${mx.toFixed(1)}µm@${sp.peakF.toFixed(0)}Hz σ=${gr.sigma.toFixed(1)}`);
  }
  const ea = M.eigenAnalysis(L, { fmin: 5 });
  console.log(`${tag} v=${q.vExit} delay=${delay} breaks=${S.breaks} (${ms}ms, ${(ms/steps*1000).toFixed(1)}µs/step): ${out.join(' | ')} || eig ${ea.critical.f.toFixed(0)}Hz Re=${ea.critical.re.toFixed(1)}`);
  return S;
}
const q = { ...p, zeta: z };
run({ ...q, vExit: 600 }, 2, true, 'stable?');
run({ ...q, vExit: 1200 }, 2, true, 'crit?');
run({ ...q, vExit: 1600 }, 2, true, 'unstable');
run({ ...q, vExit: 1600 }, 2, false, 'unstable-nodelay');
run({ ...q, vExit: 2000, standTypes: ['6Hi','6Hi','6Hi','6Hi','6Hi'] }, 2, true, '6Hi');
// rebind test: start stable, switch to fast, back to slow
{
  const S = new M.Sim(new M.Line({ ...q, vExit: 600 }), { delay: true });
  S.advance(20000);
  S.bind(new M.Line({ ...q, vExit: 1800 }));
  S.advance(40000);
  let mx = 0; const g = S.window(S.chan.gauge[2], 20000); for (const v of g) mx = Math.max(mx, Math.abs(v));
  console.log(`rebind fast: max=${mx.toFixed(1)} breaks=${S.breaks}`);
  S.bind(new M.Line({ ...q, vExit: 500 }));
  S.advance(40000);
  mx = 0; const g2 = S.window(S.chan.gauge[2], 10000); for (const v of g2) mx = Math.max(mx, Math.abs(v));
  console.log(`rebind slow: max(last .5s)=${mx.toFixed(2)} breaks=${S.breaks}`);
  S.bind(new M.Line({ ...q, vExit: 500, standTypes: ['6Hi','4Hi','4Hi','4Hi','4Hi'] }));
  S.advance(2000);
  console.log('mixed types ok, N=', S.line.N, 'finite=', isFinite(S.y[0]));
}
