// Regression checks for model.js: exits 1 if any fails (test_model.js / test_sim.js only print).
// Numbers are the default 5-stand 4Hi line (defaultParams) at the time of writing.
//   node test_check.js            (needs mlmatrix.umd.js next to it, or MLMATRIX_UMD)
//   MODEL_JS=<path> node test_check.js   (check another copy of model.js)
const fs = require('fs'), vm = require('vm'), path = require('path');
const mlmatrixPath = process.env.MLMATRIX_UMD || path.join(__dirname, 'mlmatrix.umd.js');
vm.runInThisContext(fs.readFileSync(mlmatrixPath, 'utf8'));
vm.runInThisContext(fs.readFileSync(process.env.MODEL_JS || path.join(__dirname, 'model.js'), 'utf8'));
const M = globalThis.ChatterModel;

let failed = 0;
function ok(cond, what, got) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${got !== undefined ? `  (${got})` : ''}`);
  if (!cond) failed++;
}
const within = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;

const p = M.defaultParams();
const line = new M.Line(p);

// operating point: forces and forward slips of a normal schedule
const tons = line.op.map((o) => o.P0 / 9806.65);
ok(line.op.length === 5 && tons.every((t) => within(t, 400, 900)), 'default line: 5 stands, roll force 400–900 t each', tons.map((t) => t.toFixed(0)).join('/'));
ok(line.op.every((o) => !o.skid && within(o.f0, 0.005, 0.1)), 'forward slip 0.5–10 %, no skid', line.op.map((o) => (o.f0 * 100).toFixed(2)).join('/'));
ok(line.op.every((o, i) => i === 0 || o.ks > line.op[i - 1].ks), 'the strip gets stiffer (ks) stand by stand', line.op.map((o) => (o.ks / 1e9).toFixed(1)).join('/'));

// single-stand modes: the gap-opening mode sits in the 3rd octave band
const gap = line.modes[0].find((m) => m.kind === 'gap');
ok(gap && within(gap.f, 100, 200), 'stand 1: the gap-opening mode is in 100–200 Hz', gap && gap.f.toFixed(0));

// coupled eigenvalues: stable just under the critical speed, 3rd-octave mode critical
const ea = M.eigenAnalysis(line, { fmin: 5 });
ok(ea.critical.re < 0 && within(ea.critical.f, 100, 200), 'at 1000 m/min: stable, least damped mode in 100–200 Hz', `${ea.critical.f.toFixed(0)} Hz, Re ${ea.critical.re.toFixed(2)}`);

// critical speed by bisection on max Re λ
function crit(q) {
  let lo = 60, hi = 3000;
  const f = (v) => M.eigenAnalysis(new M.Line({ ...q, vExit: v }), { fmin: 5 }).maxRe;
  if (f(lo) > 0) return lo;
  if (f(hi) < 0) return hi;
  for (let i = 0; i < 12; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}
const c4 = crit(p);
const c6 = crit({ ...p, standTypes: Array(5).fill('6Hi') });
ok(within(c4, 1041 * 0.95, 1041 * 1.05), 'critical speed, 4Hi: 1041 m/min ± 5 %', c4.toFixed(0));
ok(c6 > 1.5 * c4, '6Hi is much more stable than 4Hi', `${c6.toFixed(0)} vs ${c4.toFixed(0)} m/min`);
const cLow = crit({ ...p, zeta: 0.06 });
ok(cLow < c4, 'less structural damping, lower critical speed', `ζ 0.06: ${cLow.toFixed(0)} m/min`);

// time domain: chatter above the critical speed grows, a break resets, nothing goes NaN
{
  const S = new M.Sim(new M.Line(p), { delay: true });
  S.advance(200);
  S.y[0] = NaN;
  S.advance(50);
  ok(S.breaks >= 1 && Number.isFinite(S.y[0]), 'a NaN in the state is a break, and the state is reset');
}
{
  const S = new M.Sim(new M.Line({ ...p, vExit: 1800 }), { delay: true, breakAmp: 1e9 });
  S.advance(20000);
  let bad = false;
  for (let i = 0; i < S.y.length; i++) if (!Number.isFinite(S.y[i])) bad = true;
  const g = S.window(S.chan.gauge[2], 4000);
  let mx = 0;
  for (const v of g) mx = Math.max(mx, Math.abs(v));
  ok(!bad && mx > 100, '1800 m/min for 1 s: chatter grows (gauge > 100 µm) and stays finite', `${mx.toFixed(0)} µm`);
}
{
  const S = new M.Sim(new M.Line(p), { delay: true });
  S.advance(40000);
  const sp = M.spectrum(S.window(S.chan.gauge[2], 8192), 8192, S.fs, 8192, 800);
  ok(within(sp.peakF, 100, 200), 'at 1000 m/min the gauge spectrum peaks in the 3rd octave band', `${sp.peakF.toFixed(0)} Hz`);
}

console.log(failed ? `${failed} check(s) failed` : 'all passed');
process.exit(failed ? 1 : 0);
