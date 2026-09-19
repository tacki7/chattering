/* =====================================================================
 * Tandem cold-mill chatter model  (pure JS, no DOM)
 *
 *  - Per-stand roll-stack mass–spring–damper model (4Hi: 4 DOF, 6Hi: 6 DOF)
 *  - Roll-bite model: Hill's rolling-force formula + Hitchcock flattening,
 *    Bland–Ford neutral angle → forward slip
 *  - Inter-stand strip tension dynamics  dσ/dt = E/L·(v_in,i+1 − v_out,i)
 *  - Entry-gauge transport delay  h1,i(t) = h2,i-1(t − L/v)
 *  - Linearisation (numerical Jacobian) + eigen-analysis for stability maps
 *  - RK4 time-domain simulation with delay lines, FFT, growth-rate estimate
 *
 *  Units: length mm (roll gap, strip), displacement of masses m,
 *         force N, stress MPa, mass kg, stiffness N/m, time s.
 * ===================================================================== */
(function (root) {
  'use strict';

  const RHO = 7850;               // kg/m^3 (steel rolls)
  const TWO_PI = 2 * Math.PI;

  /* ------------------------------------------------------------------
   * Default parameter set: generic 5-stand tandem cold mill
   * ------------------------------------------------------------------ */
  function defaultParams() {
    return {
      standTypes: ['4Hi', '4Hi', '4Hi', '4Hi', '4Hi'],
      Lgap: 4500,        // mm  inter-stand distance
      width: 1000,       // mm  strip width
      barrel: 1500,      // mm  roll barrel length
      // roll diameters (mm)
      dWR4: 550, dBUR4: 1400,
      dWR6: 420, dIMR6: 500, dBUR6: 1350,
      // 20Hi (Sendzimir) cluster: WR – 1st IMR ×2 – 2nd IMR ×3 – backing assemblies ×4 per half
      dWR20: 70, dIMR1_20: 135, dIMR2_20: 220, dBB20: 400,
      kWI1_20: 15, kI1I2_20: 30, kI2BB20: 50, kHouse20: 40,   // GN/m (per half, lumped)
      // chock + bearing mass per side (kg)
      chockWR: 1500, chockIMR: 1500, chockBUR: 6000,
      neckFactor: 1.2,   // roll body mass × (1+neck allowance)
      // stiffness (GN/m)
      kHouse: 12,        // housing + screw-down / hydraulic cylinder, each half
      kWB: 40,           // WR–BUR contact (4Hi)
      kWI: 35,           // WR–IMR contact (6Hi)
      kIB: 45,           // IMR–BUR contact (6Hi)
      zeta: 0.13,        // structural damping ratio per element (calibrates the critical speed)
      // strip material (low-carbon steel)
      E: 210000, nu: 0.3, K: 640, n: 0.20, eps0: 0.01,
      h0: 2.0,           // mm  entry (hot band) thickness
      // schedule
      h: [1.40, 0.98, 0.70, 0.52, 0.45],            // mm exit thickness per stand
      mu: [0.035, 0.032, 0.030, 0.028, 0.025],      // friction coefficient per stand
      sigma: [40, 120, 140, 150, 150, 45],          // MPa: entry, 1-2, 2-3, 3-4, 4-5, exit
      vExit: 1000,       // m/min  last-stand exit speed
      kappa: 0.5,        // dynamic roll-bite volume coefficient
      // housing stretch: top crosshead mass on the post stiffness, screw-down stiffness in series
      housingOn: false,
      mHouse: 40,        // t     effective mass of the top crosshead + screw-down assembly
      kPost: 30,         // GN/m  housing post elongation stiffness (both posts, per stand)
      // horizontal (rolling-direction) degrees of freedom for every roll
      horizOn: true,
      kx: 4,             // GN/m  WR chock horizontal support stiffness (per roll)
      kxI: 6,            // GN/m  IMR chock horizontal support (6Hi)
      kxB: 25,           // GN/m  BUR / backing-assembly horizontal support
      kt: 0.5,           // tangential (friction) contact stiffness as a fraction of the normal contact stiffness
      eOff: 6,           // mm    WR offset toward the exit side (BUR contact line inclination)
      lam: 0.45,         // torque-arm coefficient: per-roll torque G = λ·l·P
      // drive-train torsion: motor(+gear, pinion) – spindle – top/bottom WR, with backlash and speed PI
      torsOn: false,
      tors: { JM: 8000, JW: 180, C: 3.0, zeta: 0.03, backlash: 0, fsc: 3 },   // kg·m² (roll-speed referred), kg·m², MN·m/rad, –, mrad (total), Hz (0 = torque-constant)
      // end reels (payoff / tension reel) with tension control — used when reelOn
      reelOn: false,
      reel: { R: 0.8, J: 5000, L: 3000, fv: 5, ft: 1.0 },   // radius m, inertia kg·m², reel–stand distance mm, speed-loop Hz, tension-loop Hz
    };
  }

  /* ------------------------------------------------------------------
   * Material: plane-strain flow stress  k = (2/√3)·K·(ε0+ε)^n
   * ------------------------------------------------------------------ */
  function flowStress(mat, eps) {
    return 1.1547 * mat.K * Math.pow(mat.eps0 + Math.max(eps, 0), mat.n);
  }

  /* ------------------------------------------------------------------
   * Roll bite.  Returns force P [N], forward slip f, contact length l [mm],
   * flattened radius Rp [mm].  Rp iteration warm-started from Rp0.
   * ------------------------------------------------------------------ */
  function bite(h1, h2, sb, sf, mu, R, w, epsIn, mat, Rp0, iters) {
    if (!(h1 > 0) || !(h2 < h1 - 1e-9)) {
      return { P: 0, f: 0, l: 0, Rp: R, kbar: flowStress(mat, epsIn), r: 0, Qp: 0, skid: true, open: true };
    }
    if (h2 < 0.05 * h1) h2 = 0.05 * h1;          // physical limit of the roll gap
    const dh = h1 - h2;
    const r = dh / h1;
    const kbar = (flowStress(mat, epsIn) + 2 * flowStress(mat, epsIn + Math.log(h1 / h2))) / 3;
    const smean = 0.5 * (sb + sf);
    const kEff = Math.max(kbar - smean, 0.05 * kbar);
    const c = 16 * (1 - mat.nu * mat.nu) / (Math.PI * mat.E);   // mm^2/N
    let Rp = Rp0 || R, P = 0, l = 0, Qp = 0;
    const sq1r = Math.sqrt(1 - r);
    for (let it = 0; it < (iters || 3); it++) {
      l = Math.sqrt(Rp * dh);
      Qp = 1.08 + 1.79 * r * mu * sq1r * Math.sqrt(Rp / h1) - 1.02 * r;
      P = w * l * Qp * kEff;
      Rp = Math.min(R * (1 + c * P / (w * dh)), 8 * R);
    }
    // Bland–Ford neutral angle → forward slip
    const a = Math.sqrt(h2 / Rp);
    const tb = Math.max(1 - sb / kbar, 0.05);
    const tf = Math.max(1 - sf / kbar, 0.05);
    let arg = 0.5 * Math.atan(Math.sqrt(r / (1 - r))) - (a / (4 * mu)) * Math.log((h1 / h2) * tf / tb);
    let skid = false;
    if (arg < 0) { arg = 0; skid = true; }
    const phin = a * Math.tan(arg);
    const f = (Rp / h2) * phin * phin;
    return { P, f, l, Rp, kbar, r, Qp, skid, open: false };
  }

  /* ------------------------------------------------------------------
   * Roll stack (per stand).  Masses ordered top→bottom.
   * ------------------------------------------------------------------ */
  function buildStand(type, p) {
    const vol = d => Math.PI / 4 * Math.pow(d / 1000, 2) * (p.barrel / 1000);
    const mass = (d, chock) => RHO * vol(d) * p.neckFactor + 2 * chock;
    let s;
    if (type === '20Hi') {
      // lumped 1-2-3-4 cluster per half: WR (no chocks), 1st IMR pair, 2nd IMR triplet, 4 backing assemblies
      const mW = RHO * vol(p.dWR20) * p.neckFactor;
      const mI1 = 2 * RHO * vol(p.dIMR1_20) * p.neckFactor;
      const mI2 = 3 * RHO * vol(p.dIMR2_20) * p.neckFactor;
      const mB = 4 * RHO * vol(p.dBB20) * 1.3;
      s = {
        type, n: 8, cluster: true,
        names: ['BB上', 'IMR2上', 'IMR1上', 'WR上', 'WR下', 'IMR1下', 'IMR2下', 'BB下'],
        short: ['BB', 'IMR2', 'IMR1', 'WR', 'WR', 'IMR1', 'IMR2', 'BB'],
        m: [mB, mI2, mI1, mW, mW, mI1, mI2, mB],
        radii: [p.dBB20 / 2, p.dIMR2_20 / 2, p.dIMR1_20 / 2, p.dWR20 / 2, p.dWR20 / 2, p.dIMR1_20 / 2, p.dIMR2_20 / 2, p.dBB20 / 2],
        springs: [
          { a: 0, b: -1, k: p.kHouse20 * 1e9 },
          { a: 0, b: 1, k: p.kI2BB20 * 1e9 },
          { a: 1, b: 2, k: p.kI1I2_20 * 1e9 },
          { a: 2, b: 3, k: p.kWI1_20 * 1e9 },
          { a: 4, b: 5, k: p.kWI1_20 * 1e9 },
          { a: 5, b: 6, k: p.kI1I2_20 * 1e9 },
          { a: 6, b: 7, k: p.kI2BB20 * 1e9 },
          { a: 7, b: -1, k: p.kHouse20 * 1e9 },
        ],
        iTW: 3, iBW: 4, R: p.dWR20 / 2,
      };
    } else if (type === '6Hi') {
      const mB = mass(p.dBUR6, p.chockBUR), mI = mass(p.dIMR6, p.chockIMR), mW = mass(p.dWR6, p.chockWR);
      s = {
        type, n: 6,
        names: ['BUR上', 'IMR上', 'WR上', 'WR下', 'IMR下', 'BUR下'],
        short: ['BUR', 'IMR', 'WR', 'WR', 'IMR', 'BUR'],
        m: [mB, mI, mW, mW, mI, mB],
        radii: [p.dBUR6 / 2, p.dIMR6 / 2, p.dWR6 / 2, p.dWR6 / 2, p.dIMR6 / 2, p.dBUR6 / 2],
        springs: [
          { a: 0, b: -1, k: p.kHouse * 1e9 },
          { a: 0, b: 1, k: p.kIB * 1e9 },
          { a: 1, b: 2, k: p.kWI * 1e9 },
          { a: 3, b: 4, k: p.kWI * 1e9 },
          { a: 4, b: 5, k: p.kIB * 1e9 },
          { a: 5, b: -1, k: p.kHouse * 1e9 },
        ],
        iTW: 2, iBW: 3, R: p.dWR6 / 2,
      };
    } else {
      const mB = mass(p.dBUR4, p.chockBUR), mW = mass(p.dWR4, p.chockWR);
      s = {
        type: '4Hi', n: 4,
        names: ['BUR上', 'WR上', 'WR下', 'BUR下'],
        short: ['BUR', 'WR', 'WR', 'BUR'],
        m: [mB, mW, mW, mB],
        radii: [p.dBUR4 / 2, p.dWR4 / 2, p.dWR4 / 2, p.dBUR4 / 2],
        springs: [
          { a: 0, b: -1, k: p.kHouse * 1e9 },
          { a: 0, b: 1, k: p.kWB * 1e9 },
          { a: 2, b: 3, k: p.kWB * 1e9 },
          { a: 3, b: -1, k: p.kHouse * 1e9 },
        ],
        iTW: 1, iBW: 2, R: p.dWR4 / 2,
      };
    }
    // housing stretch option: prepend the crosshead mass; top BUR–ground spring becomes crosshead–BUR (k_sd)
    if (p.housingOn) {
      const kH = (type === '20Hi' ? p.kHouse20 : p.kHouse) * 1e9, kPost = p.kPost * 1e9;
      const kSd = kPost > 1.05 * kH ? kPost * kH / (kPost - kH) : 20 * kH;   // series value keeps the static stiffness = kH
      s.m.unshift(p.mHouse * 1000); s.radii.unshift(0);
      s.names.unshift('ハウジング上'); s.short.unshift('H');
      s.springs = s.springs.map(sp => ({ a: sp.a + 1, b: sp.b < 0 ? -1 : sp.b + 1, k: sp.k }));
      const top = s.springs.find(sp => sp.a === 1 && sp.b === -1);
      top.b = 0; top.k = kSd;
      s.springs.unshift({ a: 0, b: -1, k: kPost });
      s.n++; s.iTW++; s.iBW++; s.iH = 0; s.housing = true; s.kSd = kSd; s.kPost = kPost;
    }
    s.rollIdx = Array.from({ length: s.n }, (_, j) => j).filter(j => !(s.housing && j === 0));
    s.iTB = s.housing ? 1 : 0;                          // top backup roll / backing assembly (vibration pickup)
    // element damping  c = 2ζ√(k·m_red)
    for (const sp of s.springs) {
      const ma = s.m[sp.a];
      const mred = sp.b < 0 ? ma : ma * s.m[sp.b] / (ma + s.m[sp.b]);
      sp.c = 2 * p.zeta * Math.sqrt(sp.k * mred);
    }
    // horizontal DOFs: one per roll, appended after the vertical ones (same order)
    s.nx = p.horizOn ? s.n : 0;
    s.nd = s.n + s.nx;
    if (s.nx) {
      const kxOf = j => {
        const t = s.short[j];
        if (t === 'H') return 100e9;                          // crosshead: part of the housing, horizontally rigid
        if (t === 'WR') return p.kx * 1e9;
        if (t === 'IMR') return p.kxI * 1e9;
        if (t === 'IMR1' || t === 'IMR2') return 0;          // 20Hi intermediates: held by contacts only
        return p.kxB * 1e9;                                   // BUR / backing assemblies
      };
      s.hsprings = [];
      for (let j = 0; j < s.n; j++) { const k = kxOf(j); if (k > 0) s.hsprings.push({ a: j, b: -1, k }); }
      // tangential (friction) contact stiffness between every pair of rolls in contact
      for (const sp of s.springs) if (sp.b >= 0) s.hsprings.push({ a: sp.a, b: sp.b, k: p.kt * sp.k, contact: true });
      for (const hs of s.hsprings) {
        const ma = s.m[hs.a];
        const mred = hs.b < 0 ? ma : ma * s.m[hs.b] / (ma + s.m[hs.b]);
        hs.c = 2 * p.zeta * Math.sqrt(hs.k * mred);
      }
      s.Radj = s.radii[s.iTW - 1];              // roll in contact above the top WR (BUR or IMR)
      s.names = s.names.concat(s.names.map(nm => nm + ' x'));
      s.short = s.short.concat(s.short.map(t => t + 'x'));
    }
    return s;
  }

  /* ------------------------------------------------------------------
   * Undamped modal analysis of one stand with the strip acting as a
   * spring ks (= −∂P/∂h2) between the two work rolls   (textbook Fig. 8.41)
   * ------------------------------------------------------------------ */
  function standModes(stand, ks, P0) {
    const ML = root.mlMatrix;
    const n = stand.n, nd = stand.nd || n;
    const mass = stand.m.slice();
    if (stand.nx) for (let j = 0; j < stand.n; j++) mass.push(stand.m[j]);
    const K = Array.from({ length: nd }, () => new Array(nd).fill(0));
    const add = (a, b, k) => {
      K[a][a] += k;
      if (b >= 0) { K[b][b] += k; K[a][b] -= k; K[b][a] -= k; }
    };
    for (const sp of stand.springs) add(sp.a, sp.b, sp.k);
    add(stand.iTW, stand.iBW, ks);
    if (stand.nx) {
      for (const hs of stand.hsprings) add(n + hs.a, hs.b < 0 ? -1 : n + hs.b, hs.k);
      // inclined-contact geometric stiffness (negative) between rolls carrying the load
      for (const sp of stand.springs) if (sp.b >= 0) add(n + sp.a, n + sp.b, -1000 * (P0 || 0) / (stand.radii[sp.a] + stand.radii[sp.b]));
    }
    // symmetric problem  M^-1/2 K M^-1/2
    const S = Array.from({ length: nd }, (_, i) =>
      Array.from({ length: nd }, (_, j) => K[i][j] / Math.sqrt(mass[i] * mass[j])));
    if (!S.every(row => row.every(Number.isFinite))) {
      return Array.from({ length: nd }, (_, k) => ({ omega: 0, f: 0, phi: new Array(nd).fill(0), antisym: false, gap: 0, dom: 0, label: '—', kind: 'na' }));
    }
    const evd = new ML.EigenvalueDecomposition(new ML.Matrix(S));
    const lam = evd.realEigenvalues, V = evd.eigenvectorMatrix;
    const modes = [];
    for (let k = 0; k < nd; k++) {
      const w = Math.sqrt(Math.max(lam[k], 0));
      let phi = [];
      for (let j = 0; j < nd; j++) phi.push(V.get(j, k) / Math.sqrt(mass[j]));
      let mx = 0; for (const v of phi) mx = Math.max(mx, Math.abs(v));
      phi = phi.map(v => v / (mx || 1));
      // horizontal mode?  (energy in the x DOFs)
      let ex = 0, ev = 0;
      for (let j = 0; j < n; j++) ev += phi[j] * phi[j];
      for (let j = n; j < nd; j++) ex += phi[j] * phi[j];
      if (ex > ev) {
        let dom = n; for (let j = n + 1; j < nd; j++) if (Math.abs(phi[j]) > Math.abs(phi[dom])) dom = j;
        if (phi[dom] < 0) phi = phi.map(v => -v);
        modes.push({ omega: w, f: w / TWO_PI, phi, antisym: false, gap: 0, dom, label: `水平振動（${stand.short[dom - n]} 卓越）`, kind: 'horiz' });
        continue;
      }
      if (phi[stand.iTW] < 0 || (Math.abs(phi[stand.iTW]) < 1e-9 && phi[0] < 0)) phi = phi.map(v => -v);
      const Rl = stand.rollIdx || Array.from({ length: n }, (_, j) => j), nr = Rl.length;
      // symmetry about the pass line (rolls only)
      let A = 0, Sy = 0;
      for (let q = 0; q < nr; q++) { const j = Rl[q], mj = Rl[nr - 1 - q]; A += (phi[j] + phi[mj]) ** 2; Sy += (phi[j] - phi[mj]) ** 2; }
      const antisym = A < Sy;
      const gap = phi[stand.iTW] - phi[stand.iBW];
      // dominant mass (housing included)
      let dom = 0; for (let j = 1; j < n; j++) if (Math.abs(phi[j]) > Math.abs(phi[dom])) dom = j;
      // is the top half moving as one block?
      const top = Rl.slice(0, nr / 2).map(j => phi[j]);
      let block = true;
      for (let j = 1; j < top.length; j++) if (Math.sign(top[j]) !== Math.sign(top[0]) || Math.abs(top[j]) < 0.3 * Math.abs(top[0]) && Math.abs(top[0]) > 0.5) block = false;
      let label, kind;
      if (stand.housing && dom === 0) { label = `ハウジング伸び振動（${antisym ? '逆位相' : '同位相'}）`; kind = 'house'; }
      else if (antisym && block) { label = 'ギャップ開閉（上下逆位相・一体）'; kind = 'gap'; }
      else if (antisym) { label = `ギャップ開閉（${stand.short[dom]} 卓越・逆位相）`; kind = 'gap-hi'; }
      else if (block) { label = 'スタック並進（上下同位相）'; kind = 'trans'; }
      else { label = `同位相（${stand.short[dom]} 卓越）`; kind = 'sym-hi'; }
      modes.push({ omega: w, f: w / TWO_PI, phi, antisym, gap, dom, label, kind });
    }
    // top and bottom horizontal chains are uncoupled → degenerate pairs: present them as in-phase / anti-phase
    const hz = modes.filter(mm => mm.kind === 'horiz').sort((a, b) => a.f - b.f);
    for (let k = 0; k + 1 < hz.length && n % 2 === 0; k++) {
      const A = hz[k], B = hz[k + 1];
      if (Math.abs(A.f - B.f) > 1e-6 * Math.max(A.f, 1e-9)) continue;
      const half = n / 2;
      const mirror = j => (n - 1 - j);
      // take the top-half pattern from whichever vector has it, mirror it to the bottom
      let t = new Array(n).fill(0), src = null;
      for (const cand of [A, B]) { let e = 0; for (let j = 0; j < half; j++) e += cand.phi[n + j] ** 2; if (e > 1e-12) { src = cand; break; } }
      if (!src) { k++; continue; }
      for (let j = 0; j < half; j++) t[j] = src.phi[n + j];
      const mk = (sign) => { const p2 = new Array(nd).fill(0); for (let j = 0; j < half; j++) { p2[n + j] = t[j]; p2[n + mirror(j)] = sign * t[j]; } let mx = 0; for (const v of p2) mx = Math.max(mx, Math.abs(v)); return p2.map(v => v / (mx || 1)); };
      let dom = 0; for (let j = 1; j < half; j++) if (Math.abs(t[j]) > Math.abs(t[dom])) dom = j;
      A.phi = mk(1); A.antisym = false; A.label = `水平振動（${stand.short[dom]} 卓越・上下同相）`;
      B.phi = mk(-1); B.antisym = true; B.label = `水平振動（${stand.short[dom]} 卓越・上下逆相）`;
      k++;
    }
    modes.sort((a, b) => a.f - b.f);
    return modes;
  }

  /** spindle torque deviation with optional backlash (dead band 'bl' rad total) around the static twist delta0 */
  function spindleTorque(dphi, dw, tk, delta0) {
    if (tk.bl <= 0) return tk.C * dphi + tk.d * dw;
    const h = tk.bl / 2, delta = delta0 + dphi;
    let tot;
    if (delta > h) tot = tk.C * (delta - h) + tk.d * dw;
    else if (delta < -h) tot = tk.C * (delta + h) + tk.d * dw;
    else tot = 0;
    return tot - tk.C * (delta0 - h);
  }
  /** undamped torsional modes of the motor – spindle – WR/WR 3-inertia system (rigid-body mode dropped) */
  function torsModes(tk) {
    const ML = root.mlMatrix;
    const K = [[2 * tk.C, -tk.C, -tk.C], [-tk.C, tk.C, 0], [-tk.C, 0, tk.C]];
    const mass = [tk.JM, tk.JW, tk.JW];
    const S = K.map((row, i) => row.map((v, j) => v / Math.sqrt(mass[i] * mass[j])));
    const evd = new ML.EigenvalueDecomposition(new ML.Matrix(S));
    const lam = evd.realEigenvalues, V = evd.eigenvectorMatrix;
    const out = [];
    for (let k = 0; k < 3; k++) {
      const w = Math.sqrt(Math.max(lam[k], 0));
      if (w < 1e-3) continue;
      let phi = [0, 1, 2].map(j => V.get(j, k) / Math.sqrt(mass[j]));
      let mx = 0; for (const v of phi) mx = Math.max(mx, Math.abs(v));
      phi = phi.map(v => v / (mx || 1));
      if (phi[1] < 0) phi = phi.map(v => -v);
      const anti = Math.sign(phi[1]) !== Math.sign(phi[2]);
      out.push({ omega: w, f: w / TWO_PI, phi, antisym: anti, kind: 'tors', label: anti ? 'ねじり（上下 WR 逆相）' : 'ねじり（電動機–WR 同相）' });
    }
    out.sort((a, b) => a.f - b.f);
    return out;
  }

  /* ------------------------------------------------------------------
   * The 5-stand line: operating point + nonlinear state derivative
   * ------------------------------------------------------------------ */
  class Line {
    constructor(p) {
      this.p = p;
      this.mat = { E: p.E, nu: p.nu, K: p.K, n: p.n, eps0: p.eps0 };
      this.nS = p.h.length;
      this.stands = p.standTypes.map(t => buildStand(t, p));
      this.off = [];
      let o = 0;
      for (const s of this.stands) { this.off.push(o); o += 2 * s.nd; }
      this.T = o;                       // interstand tension states start
      this.reel = !!p.reelOn;
      this.Rr = o + (this.nS - 1);      // reel states start: [σb, ωp, zp, σf, ωt, zt]
      this.tors = !!p.torsOn;
      this.Tr = this.Rr + (this.reel ? 6 : 0);   // torsion states start: per stand [φM, ωM, φWT, ωWT, φWB, ωWB, z_sc]
      this.N = this.Tr + (this.tors ? 7 * this.nS : 0);
      // finite-difference steps per state (used by linearize)
      this.steps = new Float64Array(this.N);
      for (let i = 0; i < this.nS; i++) { const s = this.stands[i], o2 = this.off[i]; for (let j = 0; j < s.nd; j++) { this.steps[o2 + j] = 1e-7; this.steps[o2 + s.nd + j] = 1e-3; } }
      for (let k = this.T; k < this.Tr; k++) this.steps[k] = 1e-2;
      for (let i = 0; i < (this.tors ? this.nS : 0); i++) { const q = this.Tr + 7 * i; this.steps.set([1e-6, 1e-4, 1e-6, 1e-4, 1e-6, 1e-4, 1e-4], q); }
      this._v1 = new Float64Array(this.nS);
      this._v2 = new Float64Array(this.nS);
      this._P = new Float64Array(this.nS);
      this._h2 = new Float64Array(this.nS);
      this._MT = new Float64Array(this.nS);             // top spindle torque deviation (N·m)
      this._aWR = new Float64Array(this.nS);            // vertical acceleration of the top WR (m/s²)
      this._aBW = new Float64Array(this.nS);            // vertical acceleration of the bottom WR (m/s²)
      this._acc = new Float64Array(24);
      this.computeOperatingPoint();
    }

    computeOperatingPoint() {
      const p = this.p, mat = this.mat;
      const vExit = p.vExit * 1000 / 60;         // mm/s
      const Q = vExit * p.h[this.nS - 1];        // mass-flow constant (mm^2/s)
      this.Q = Q;
      this.op = [];
      for (let i = 0; i < this.nS; i++) {
        const s = this.stands[i];
        const h1 = i ? p.h[i - 1] : p.h0, h2 = p.h[i];
        const sb = p.sigma[i], sf = p.sigma[i + 1];
        const epsIn = Math.log(p.h0 / h1);
        const R = s.R, w = p.width, mu = p.mu[i];
        let Rp = R;
        for (let it = 0; it < 40; it++) Rp = bite(h1, h2, sb, sf, mu, R, w, epsIn, mat, Rp, 1).Rp;
        const b = bite(h1, h2, sb, sf, mu, R, w, epsIn, mat, Rp, 3);
        const d = 1e-4;
        const Pp = bite(h1, h2 + d, sb, sf, mu, R, w, epsIn, mat, Rp, 3).P;
        const Pm = bite(h1, h2 - d, sb, sf, mu, R, w, epsIn, mat, Rp, 3).P;
        const dPdh2 = (Pp - Pm) / (2 * d);                 // N/mm
        const dPdsb = (bite(h1, h2, sb + 1, sf, mu, R, w, epsIn, mat, Rp, 3).P - bite(h1, h2, sb - 1, sf, mu, R, w, epsIn, mat, Rp, 3).P) / 2;
        const dPdsf = (bite(h1, h2, sb, sf + 1, mu, R, w, epsIn, mat, Rp, 3).P - bite(h1, h2, sb, sf - 1, mu, R, w, epsIn, mat, Rp, 3).P) / 2;
        const v2 = Q / h2, v1 = Q / h1, vR = v2 / (1 + b.f);
        this.op.push({
          h1, h2, sb, sf, mu, epsIn, R, w, Rp0: Rp,
          P0: b.P, f0: b.f, l0: b.l, kbar: b.kbar, r: b.r, Qp: b.Qp, skid: b.skid,
          dPdh2, dPdsb, dPdsf, ks: -dPdh2 * 1000,
          v1, v2, vR, red: b.r,
        });
      }
      for (const op of this.op) op.G0 = p.lam * op.l0 * op.P0 * 1e-3 + 0.5 * (op.sb * op.h1 - op.sf * op.h2) * p.width * op.R * 1e-3;   // N·m per roll
      if (this.tors) {
        const t = p.tors, C = t.C * 1e6, wsc = TWO_PI * t.fsc;
        this.torsK = { JM: t.JM, JW: t.JW, C, d: 2 * t.zeta * Math.sqrt(C * t.JW), bl: t.backlash * 1e-3, Kp: t.JM * wsc, Ki: t.JM * wsc * wsc / 4 };
        for (const op of this.op) op.delta0 = Math.max(op.G0 / C, this.torsK.bl / 2 + 1e-6);   // static spindle twist
      }
      this.torsModes = this.tors ? this.stands.map((s, i) => torsModes(this.torsK)) : this.stands.map(() => []);
      this.tau = [];
      for (let k = 0; k < this.nS - 1; k++) this.tau.push(p.Lgap / this.op[k].v2);
      if (this.reel) {
        const r = p.reel, wv = TWO_PI * r.fv, wt = TWO_PI * r.ft;
        const Ap = p.width * p.h0, At = p.width * p.h[this.nS - 1];   // strip section mm²
        const Kv = r.J * wv;                                          // speed loop N·m·s/rad
        // speed-loop droop: reel surface-speed change per MPa of strip tension (mm/s per MPa)
        const Dp = 1000 * r.R * r.R * Ap / Kv, Dt = 1000 * r.R * r.R * At / Kv;
        const Kp = wt * r.L / p.E;                                    // tension P: mm/s per MPa
        this.reelK = {
          R: r.R, J: r.J, L: r.L, Ap, At, Kv, Kp,
          Kip: wt * (Kp + Dp), Kit: wt * (Kp + Dt),                   // integral gains → tension recovery at ~ft
        };
      }
      this.modes = this.stands.map((s, i) => standModes(s, this.op[i].ks, this.op[i].P0));
    }

    /** back / front tension actually acting on stand i for state y */
    tensions(y, i) {
      const p = this.p;
      let sb = i === 0 ? p.sigma[0] : p.sigma[i] + y[this.T + i - 1];
      let sf = i === this.nS - 1 ? p.sigma[this.nS] : p.sigma[i + 1] + y[this.T + i];
      if (this.reel) {
        if (i === 0) sb += y[this.Rr];
        if (i === this.nS - 1) sf += y[this.Rr + 3];
      }
      return [sb, sf];
    }

    /**
     * dy = f(y, aux).  aux.h1[i]: entry thickness of stand i (mm),
     * aux.fext[i]: extra force on the roll gap (N, + opens the gap).
     */
    rhs(y, dy, aux) {
      const p = this.p, mat = this.mat, nS = this.nS;
      const v1 = this._v1, v2 = this._v2, acc = this._acc;
      for (let i = 0; i < nS; i++) {
        const s = this.stands[i], o = this.off[i], n = s.n, nd = s.nd, op = this.op[i];
        const xg = y[o + s.iTW] - y[o + s.iBW];
        const vg = y[o + nd + s.iTW] - y[o + nd + s.iBW];
        const h2 = op.h2 + xg * 1000;
        const hd = vg * 1000;
        const h1 = aux.h1[i];
        const sbf = this.tensions(y, i);
        const b = bite(h1, h2, sbf[0], sbf[1], op.mu, op.R, op.w, op.epsIn, mat, op.Rp0, 3);
        const dP = b.P - op.P0 + (aux.fext ? aux.fext[i] : 0);
        this._P[i] = b.P; this._h2[i] = h2;
        // roll surface speed follows the (mean) work-roll angular velocity deviation when torsion is on
        const qT = this.Tr + 7 * i;
        const dwAvg = this.tors ? 0.5 * (y[qT + 3] + y[qT + 5]) : 0;
        const vo = (op.vR + op.R * dwAvg) * (1 + b.f);
        // bite translation: the whole roll gap moves with the mean WR horizontal velocity
        const vx = s.nx ? 500 * (y[o + nd + n + s.iTW] + y[o + nd + n + s.iBW]) : 0;   // mm/s
        v2[i] = vo + vx;
        v1[i] = (vo * h2 + p.kappa * b.l * hd) / h1 + vx;
        // mechanics (vertical)
        for (let j = 0; j < nd; j++) acc[j] = 0;
        for (const sp of s.springs) {
          const xa = y[o + sp.a], va = y[o + nd + sp.a];
          const xb = sp.b < 0 ? 0 : y[o + sp.b], vb = sp.b < 0 ? 0 : y[o + nd + sp.b];
          const F = -sp.k * (xa - xb) - sp.c * (va - vb);
          acc[sp.a] += F;
          if (sp.b >= 0) acc[sp.b] -= F;
        }
        acc[s.iTW] += dP;
        acc[s.iBW] -= dP;
        // mechanics (horizontal, exit direction positive): chock supports, tangential contacts, geometry
        if (s.nx) {
          for (const hs of s.hsprings) {
            const xa = y[o + n + hs.a], va = y[o + nd + n + hs.a];
            const xb = hs.b < 0 ? 0 : y[o + n + hs.b], vb = hs.b < 0 ? 0 : y[o + nd + n + hs.b];
            const F = -hs.k * (xa - xb) - hs.c * (va - vb);
            acc[n + hs.a] += F;
            if (hs.b >= 0) acc[n + hs.b] -= F;
          }
          // inclined contact: the load through each contact pushes offset rolls further apart
          for (const sp of s.springs) if (sp.b >= 0) {
            const kg = 1000 * op.P0 / (s.radii[sp.a] + s.radii[sp.b]);
            const F = kg * (y[o + n + sp.a] - y[o + n + sp.b]);
            acc[n + sp.a] += F; acc[n + sp.b] -= F;
          }
          // excitation on the work rolls
          const Rsum = s.radii[s.iTW] + s.Radj;                       // mm
          const Fs = 0.5 * op.w * ((sbf[1] * h2 - op.sf * op.h2) - (sbf[0] * h1 - op.sb * op.h1));
          const Fb = -p.lam * (b.l * b.P - op.l0 * op.P0) / op.Rp0;
          const Fo = s.cluster ? 0 : (b.P - op.P0) * p.eOff / Rsum;   // ΔP through the nominal WR offset
          const fxn = aux.fextx ? aux.fextx[i] : 0;
          acc[n + s.iTW] += Fs + Fb + Fo + fxn;
          acc[n + s.iBW] += Fs + Fb + Fo + fxn;
        }
        for (let j = 0; j < n; j++) {
          dy[o + j] = y[o + nd + j];
          dy[o + nd + j] = acc[j] / s.m[j];
        }
        this._aWR[i] = acc[s.iTW] / s.m[s.iTW];
        this._aBW[i] = acc[s.iBW] / s.m[s.iBW];
        // drive-train torsion: motor – spindles – work rolls
        if (this.tors) {
          const tk = this.torsK;
          const phiM = y[qT], wM = y[qT + 1], phiT = y[qT + 2], wT = y[qT + 3], phiB = y[qT + 4], wB = y[qT + 5], zsc = y[qT + 6];
          const G = p.lam * b.l * b.P * 1e-3 + 0.5 * (sbf[0] * h1 - sbf[1] * h2) * p.width * op.R * 1e-3;   // N·m per roll
          const dG = G - op.G0;
          const MT = spindleTorque(phiM - phiT, wM - wT, tk, op.delta0);
          const MB = spindleTorque(phiM - phiB, wM - wB, tk, op.delta0);
          const Tm = tk.Kp > 0 ? -tk.Kp * wM + tk.Ki * zsc : 0;                  // speed PI: e = −Δω, z = ∫e dt
          this._MT[i] = MT;
          dy[qT] = wM; dy[qT + 1] = (Tm - MT - MB + (aux.ftors ? aux.ftors[i] : 0)) / tk.JM;
          dy[qT + 2] = wT; dy[qT + 3] = (MT - dG) / tk.JW;
          dy[qT + 4] = wB; dy[qT + 5] = (MB - dG) / tk.JW;
          dy[qT + 6] = -wM;
        }
        for (let q = 0; q < s.nx; q++) {
          dy[o + n + q] = y[o + nd + n + q];
          dy[o + nd + n + q] = acc[n + q] / s.m[q];
        }
      }
      const EL = p.E / p.Lgap;
      for (let k = 0; k < nS - 1; k++) {
        let ds = EL * (v1[k + 1] - v2[k]);
        const sig = p.sigma[k + 1] + y[this.T + k];
        if (sig <= 0 && ds < 0) ds = 0;
        dy[this.T + k] = ds;
      }
      if (this.reel) {
        const rk = this.reelK, Rr = this.Rr, R = rk.R, ELr = p.E / rk.L;
        // payoff reel (entry side): strip pulls the reel forward, speed-controlled drive brakes it
        const sbDev = y[Rr], wp = y[Rr + 1], zp = y[Rr + 2];
        const vp = this.op[0].v1 + 1000 * R * wp;                 // reel surface speed mm/s
        let dsb = ELr * (v1[0] - vp);
        if (p.sigma[0] + sbDev <= 0 && dsb < 0) dsb = 0;
        const ep = -sbDev;                                        // σ_ref − σ
        const dvRefP = -(rk.Kp * ep + rk.Kip * zp);               // slow the payoff to raise tension
        dy[Rr] = dsb;
        dy[Rr + 1] = (rk.Kv * (dvRefP / (1000 * R) - wp) + sbDev * rk.Ap * R) / rk.J;
        dy[Rr + 2] = ep;
        // tension reel (exit side): motor pulls, strip tension resists
        const sfDev = y[Rr + 3], wt = y[Rr + 4], zt = y[Rr + 5];
        const vt = this.op[nS - 1].v2 + 1000 * R * wt;
        let dsf = ELr * (vt - v2[nS - 1]);
        if (p.sigma[nS] + sfDev <= 0 && dsf < 0) dsf = 0;
        const et = -sfDev;
        const dvRefT = rk.Kp * et + rk.Kit * zt;                  // speed the reel up to raise tension
        dy[Rr + 3] = dsf;
        dy[Rr + 4] = (rk.Kv * (dvRefT / (1000 * R) - wt) - sfDev * rk.At * R) / rk.J;
        dy[Rr + 5] = et;
      }
    }
  }

  /* ------------------------------------------------------------------
   * Linearisation about the operating point (entry gauge held constant)
   * ------------------------------------------------------------------ */
  function linearize(line) {
    const N = line.N;
    const y = new Float64Array(N), fp = new Float64Array(N), fm = new Float64Array(N);
    const aux = { h1: line.op.map(o => o.h1), fext: null };
    const A = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let j = 0; j < N; j++) {
      const d = line.steps[j] || 1e-4;
      y[j] = d; line.rhs(y, fp, aux);
      y[j] = -d; line.rhs(y, fm, aux);
      y[j] = 0;
      for (let i = 0; i < N; i++) A[i][j] = (fp[i] - fm[i]) / (2 * d);
    }
    return A;
  }

  /** Parlett–Reinsch balancing, in place.  Returns diagonal scaling D. */
  function balance(A) {
    const n = A.length, D = new Array(n).fill(1);
    const RADIX = 2, SQR = RADIX * RADIX;
    let done = false;
    let guard = 0;
    while (!done && guard++ < 100) {
      done = true;
      for (let i = 0; i < n; i++) {
        let c = 0, r = 0;
        for (let j = 0; j < n; j++) if (j !== i) { c += Math.abs(A[j][i]); r += Math.abs(A[i][j]); }
        if (c > 0 && r > 0) {
          let g = r / RADIX, f = 1;
          const s = c + r;
          while (c < g) { f *= RADIX; c *= SQR; }
          g = r * RADIX;
          while (c > g) { f /= RADIX; c /= SQR; }
          if ((c + r) / f < 0.95 * s) {
            done = false;
            D[i] *= f;
            for (let j = 0; j < n; j++) A[i][j] /= f;
            for (let j = 0; j < n; j++) A[j][i] *= f;
          }
        }
      }
    }
    return D;
  }

  /**
   * Eigen-analysis of the coupled line.  Returns modes sorted by growth
   * rate (Re λ) descending.  Each mode: re, im, f (Hz), zeta, gapAmp per
   * stand (relative), domStand.
   */
  function eigenAnalysis(line, opts) {
    const ML = root.mlMatrix;
    const A = linearize(line);
    if (!A.every(row => row.every(Number.isFinite))) {
      const bad = { re: NaN, im: 0, f: 0, zeta: 0, gapAmp: new Array(line.nS).fill(0), tenAmp: [], domStand: 0, hfrac: 0, housefrac: 0, kind: 5 };
      return { modes: [bad], critical: bad, maxRe: NaN };
    }
    const D = balance(A);
    const evd = new ML.EigenvalueDecomposition(new ML.Matrix(A));
    const re = evd.realEigenvalues, im = evd.imaginaryEigenvalues, V = evd.eigenvectorMatrix;
    const N = A.length, modes = [];
    for (let k = 0; k < N; k++) {
      if (im[k] < 0) continue;                 // one of each conjugate pair
      if (Math.abs(im[k]) < 1e-6 && Math.abs(re[k]) < 1e-3) continue;   // rigid-body / pure-integrator eigenvalue (drive angle offset)
      const cplx = im[k] > 0;
      const gapAmp = [], tenAmp = [];
      let mx = 0;
      for (let i = 0; i < line.nS; i++) {
        const s = line.stands[i], o = line.off[i];
        const a = o + s.iTW, b = o + s.iBW;
        const gr = (V.get(a, k) * D[a] - V.get(b, k) * D[b]);
        const gi = cplx ? (V.get(a, k + 1) * D[a] - V.get(b, k + 1) * D[b]) : 0;
        const g = Math.hypot(gr, gi);
        gapAmp.push(g); mx = Math.max(mx, g);
      }
      for (let t = 0; t < line.nS - 1; t++) {
        const j = line.T + t;
        const tr = V.get(j, k) * D[j], ti = cplx ? V.get(j, k + 1) * D[j] : 0;
        tenAmp.push(Math.hypot(tr, ti));
      }
      let dom = 0; for (let i = 1; i < gapAmp.length; i++) if (gapAmp[i] > gapAmp[dom]) dom = i;
      const mag = Math.hypot(re[k], im[k]);
      // energy split of the displacement part of the eigenvector: vertical / horizontal / housing
      let vert = 0, hor = 0, hou = 0, tor = 0;
      for (let i = 0; i < line.nS; i++) {
        const s = line.stands[i], o = line.off[i];
        for (let j = 0; j < s.nd; j++) {
          const ar = V.get(o + j, k) * D[o + j], ai = cplx ? V.get(o + j, k + 1) * D[o + j] : 0;
          const a2 = ar * ar + ai * ai;
          if (j < s.n) { vert += a2; if (s.housing && j === 0) hou += a2; } else hor += a2;
        }
        if (line.tors) {
          const q = line.Tr + 7 * i, Rm = s.R * 1e-3;
          for (const jj of [q, q + 2, q + 4]) {
            const ar = V.get(jj, k) * D[jj] * Rm, ai = cplx ? V.get(jj, k + 1) * D[jj] * Rm : 0;
            tor += ar * ar + ai * ai;
          }
        }
      }
      const tot = vert + hor + tor + 1e-300;
      const f = im[k] / TWO_PI, hfrac = hor / tot, housefrac = hou / tot, tfrac = tor / tot;
      const kind = tfrac > 0.5 ? 6 : f < 30 ? 4 : hfrac > 0.5 ? 2 : housefrac > 0.4 ? 3 : f < 300 ? 0 : f < 1000 ? 1 : 5;
      modes.push({
        re: re[k], im: im[k], f,
        zeta: mag > 0 ? -re[k] / mag : 0,
        gapAmp: gapAmp.map(g => g / (mx || 1)), tenAmp, domStand: dom,
        hfrac, housefrac, tfrac, kind,
      });
    }
    modes.sort((a, b) => b.re - a.re);
    const fmin = (opts && opts.fmin) || 0;
    const osc = modes.filter(m => m.f >= fmin);
    return { modes, critical: osc[0] || modes[0], maxRe: osc.length ? osc[0].re : modes[0].re };
  }

  /* ------------------------------------------------------------------
   * Continuous time-domain simulation (RK4 + delay lines, ring history)
   * ------------------------------------------------------------------ */
  class Sim {
    constructor(line, o) {
      o = o || {};
      this.dt = o.dt || 5e-5;
      this.fs = 1 / this.dt;
      this.histSec = o.histSec || 3.0;
      this.delay = o.delay !== false;
      this.noise = o.noise != null ? o.noise : 2000;      // N rms white force on each gap (referred to dt = 5e-5 s)
      this.noiseScale = Math.sqrt(5e-5 / this.dt);
      this.entry = o.entry || { type: 'none', amp: 0, freq: 50 };
      this.breakAmp = o.breakAmp || 150;                  // µm gauge deviation → strip break
      this.seed = o.seed || 12345;
      this.breaks = 0;
      this.lastBreakT = -1;
      this.histLen = Math.ceil(this.histSec / this.dt);
      this.bind(line, true);
    }

    /** attach a (new) line model; keeps the vibration state when compatible */
    bind(line, reset) {
      const compatible = this.line && this.line.N === line.N &&
        this.line.stands.every((s, i) => s.type === line.stands[i].type);
      const prev = this.line;
      this.line = line;
      const N = line.N;
      if (!compatible || reset) {
        this.y = new Float64Array(N);
        this.k1 = new Float64Array(N); this.k2 = new Float64Array(N);
        this.k3 = new Float64Array(N); this.k4 = new Float64Array(N);
        this.yt = new Float64Array(N);
        this.t = 0; this.step = 0;
      } else {
        // tension states are deviations from nominal: re-base them
        for (let k = 0; k < line.nS - 1; k++) {
          const abs = prev.p.sigma[k + 1] + this.y[line.T + k];
          this.y[line.T + k] = abs - line.p.sigma[k + 1];
        }
      }
      this.aux = { h1: line.op.map(q => q.h1), fext: new Float64Array(line.nS), fextx: new Float64Array(line.nS), ftors: new Float64Array(line.nS) };
      // delay lines (rebuilt: length depends on speed)
      const oldBuf = this.buf, oldPtr = this.ptr;
      this.buf = [null]; this.ptr = [0];
      for (let i = 1; i < line.nS; i++) {
        const L = Math.max(2, Math.round(line.tau[i - 1] / this.dt) + 1);
        const b = new Float64Array(L);
        const nom = line.op[i - 1].h2;
        if (compatible && !reset && oldBuf && oldBuf[i]) {
          // carry over the deviation history (resampled to the new length)
          const ob = oldBuf[i], op = oldPtr[i], oL = ob.length, onom = prev.op[i - 1].h2;
          for (let j = 0; j < L; j++) {
            const back = (L - 1 - j) / (L - 1);          // 1 = oldest … 0 = newest
            const oj = (op - Math.round(back * (oL - 1)) + oL) % oL;
            b[j] = nom + (ob[oj] - onom);
          }
          this.ptr.push(L - 1);
        } else {
          b.fill(nom); this.ptr.push(0);
        }
        this.buf.push(b);
      }
      if (!this.chan || !compatible || reset) {
        const ch = (this.chan = {});
        const mk = () => new Float32Array(this.histLen);
        ch.gauge = Array.from({ length: line.nS }, mk);        // µm
        ch.force = Array.from({ length: line.nS }, mk);        // kN deviation
        ch.tension = Array.from({ length: line.nS - 1 + (line.reel ? 2 : 0) }, mk);  // MPa deviation (interstand, then entry/exit reel spans)
        ch.wr = Array.from({ length: line.nS }, mk);           // top WR displacement µm
        ch.wrx = Array.from({ length: line.nS }, mk);          // top WR horizontal displacement µm
        ch.aWR = Array.from({ length: line.nS }, mk);          // top WR vertical acceleration m/s²
        ch.aBW = Array.from({ length: line.nS }, mk);          // bottom WR vertical acceleration m/s²
        ch.tq = Array.from({ length: line.nS }, mk);           // top spindle torque deviation kN·m
        ch.wT = Array.from({ length: line.nS }, mk);           // top WR angular-velocity deviation rad/s
        ch.time = mk();
        this.w = 0; this.count = 0;
      }
      this.disp = new Float64Array(line.stands.reduce((a, s) => a + s.n, 0));
      this.dispX = new Float64Array(line.stands.reduce((a, s) => a + s.nx, 0));
      this.dispT = new Float64Array(2 * line.nS);           // WR torsional angle deviations (rad): top, bottom per stand
    }

    reset() {
      this.y.fill(0);
      for (let i = 1; i < this.line.nS; i++) this.buf[i].fill(this.line.op[i - 1].h2);
      this.aux.fext.fill(0); this.aux.fextx.fill(0); this.aux.ftors.fill(0);
    }

    /** initial velocity kick (m/s) on the roll gap of stand i */
    kick(i, dv) {
      const s = this.line.stands[i], o = this.line.off[i];
      this.y[o + s.nd + s.iTW] += dv;
      this.y[o + s.nd + s.iBW] -= dv;
    }
    /** torsional kick: angular-velocity step (rad/s) on both work rolls of stand i */
    kickT(i, dw) {
      const L = this.line; if (!L.tors) return;
      const q = L.Tr + 7 * i;
      this.y[q + 3] += dw; this.y[q + 5] += dw;
    }
    /** horizontal velocity kick (m/s) on both work rolls of stand i */
    kickX(i, dv) {
      const s = this.line.stands[i], o = this.line.off[i];
      if (!s.nx) return;
      this.y[o + s.nd + s.n + s.iTW] += dv;
      this.y[o + s.nd + s.n + s.iBW] += dv;
    }

    gauss() {
      let s = this.seed;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s >>> 0;
      const u1 = (this.seed + 1) / 4294967297;
      s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s >>> 0;
      const u2 = (this.seed + 1) / 4294967297;
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
    }

    entryGauge(t) {
      const e = this.entry, h0 = this.line.p.h0;
      if (!e || e.type === 'none' || !e.amp) return h0;
      if (e.type === 'sine') return h0 + 1e-3 * e.amp * Math.sin(TWO_PI * e.freq * t);
      if (e.type === 'noise') return h0 + 1e-3 * e.amp * this.gauss();
      if (e.type === 'step') return h0 + ((t % 1.0) > 0.5 ? 1e-3 * e.amp : 0);
      return h0;
    }

    record() {
      const L = this.line, y = this.y, r = this.w, ch = this.chan;
      let big = 0, bad = false;
      for (let i = 0; i < L.nS; i++) {
        const s = L.stands[i], o = L.off[i];
        const g = (y[o + s.iTW] - y[o + s.iBW]) * 1e6;
        ch.gauge[i][r] = g;
        if (!isFinite(g)) bad = true;
        else if (Math.abs(g) > big) big = Math.abs(g);
        ch.wr[i][r] = y[o + s.iTW] * 1e6;
        ch.wrx[i][r] = s.nx ? y[o + s.n + s.iTW] * 1e6 : 0;
        ch.aWR[i][r] = L._aWR[i]; ch.aBW[i][r] = L._aBW[i];
        ch.tq[i][r] = L.tors ? L._MT[i] * 1e-3 : 0; ch.wT[i][r] = L.tors ? y[L.Tr + 7 * i + 3] : 0;
        ch.force[i][r] = this.step === 0 && !L._P[i] ? 0 : (L._P[i] - L.op[i].P0) * 1e-3;
      }
      for (let k = 0; k < L.nS - 1; k++) ch.tension[k][r] = y[L.T + k];
      if (L.reel) { ch.tension[L.nS - 1][r] = y[L.Rr]; ch.tension[L.nS][r] = y[L.Rr + 3]; }
      ch.time[r] = this.t;
      this.w = (r + 1) % this.histLen;
      if (this.count < this.histLen) this.count++;
      for (let k = L.T; k < L.N; k++) if (!isFinite(y[k])) bad = true;
      return bad ? NaN : big;
    }

    /** last n samples of a channel, oldest first */
    window(arr, n, out) {
      n = Math.min(n, this.count);
      out = out && out.length === n ? out : new Float32Array(n);
      const start = (this.w - n + this.histLen) % this.histLen;
      const first = Math.min(n, this.histLen - start);
      out.set(arr.subarray(start, start + first), 0);
      if (first < n) out.set(arr.subarray(0, n - first), first);
      return out;
    }

    advance(nSteps) {
      const L = this.line, N = L.N, dt = this.dt, y = this.y;
      const k1 = this.k1, k2 = this.k2, k3 = this.k3, k4 = this.k4, yt = this.yt, aux = this.aux;
      let broke = false;
      for (let st = 0; st < nSteps; st++) {
        const t = this.t;
        aux.h1[0] = this.entryGauge(t);
        for (let i = 1; i < L.nS; i++) {
          if (this.delay) {
            const b = this.buf[i], p = this.ptr[i];
            aux.h1[i] = b[(p + 1) % b.length];
          } else aux.h1[i] = L.op[i].h1;
        }
        for (let i = 0; i < L.nS; i++) {
          aux.fext[i] = this.noise ? this.noise * this.noiseScale * this.gauss() : 0;
          aux.fextx[i] = this.noise ? 0.3 * this.noise * this.noiseScale * this.gauss() : 0;
        }
        L.rhs(y, k1, aux);
        // record the state at time t (forces from the k1 evaluation)
        const big = this.record();
        if (big > this.breakAmp || !isFinite(big)) {
          // strip break → new coil threaded: everything back to the operating point
          this.breaks++; this.lastBreakT = this.t; broke = true;
          this.reset();
          this.t += dt; this.step++;
          continue;
        }
        for (let j = 0; j < N; j++) yt[j] = y[j] + 0.5 * dt * k1[j];
        L.rhs(yt, k2, aux);
        for (let j = 0; j < N; j++) yt[j] = y[j] + 0.5 * dt * k2[j];
        L.rhs(yt, k3, aux);
        for (let j = 0; j < N; j++) yt[j] = y[j] + dt * k3[j];
        L.rhs(yt, k4, aux);
        for (let j = 0; j < N; j++) y[j] += dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
        for (let k = 0; k < L.nS - 1; k++) {
          const s0 = L.p.sigma[k + 1];
          if (s0 + y[L.T + k] < 0) y[L.T + k] = -s0;
        }
        if (L.reel) {
          if (L.p.sigma[0] + y[L.Rr] < 0) y[L.Rr] = -L.p.sigma[0];
          if (L.p.sigma[L.nS] + y[L.Rr + 3] < 0) y[L.Rr + 3] = -L.p.sigma[L.nS];
        }
        for (let i = 1; i < L.nS; i++) {
          const b = this.buf[i];
          const s = L.stands[i - 1], o = L.off[i - 1];
          const nom = L.op[i - 1].h2;
          this.ptr[i] = (this.ptr[i] + 1) % b.length;
          b[this.ptr[i]] = Math.max(0.05 * nom, nom + (y[o + s.iTW] - y[o + s.iBW]) * 1000);
        }
        this.t += dt; this.step++;
      }
      L.rhs(y, k1, aux);                       // forces consistent with the final state (for readouts)
      // current displacement of every roll (m) for the animation
      let q = 0, qx = 0;
      for (let i = 0; i < L.nS; i++) {
        const s = L.stands[i], o = L.off[i];
        for (let j = 0; j < s.n; j++) this.disp[q++] = y[o + j];
        for (let j = 0; j < s.nx; j++) this.dispX[qx++] = y[o + s.n + j];
        if (L.tors) { const qT = L.Tr + 7 * i; this.dispT[2 * i] = y[qT + 2]; this.dispT[2 * i + 1] = y[qT + 4]; }
      }
      return broke;
    }
  }

  /* ------------------------------------------------------------------
   * Signal tools
   * ------------------------------------------------------------------ */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -TWO_PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  /** amplitude spectrum of the last `n` samples (Hann window) */
  function spectrum(sig, count, fs, n, fmax) {
    n = n || 8192;
    if (n & (n - 1)) { let m = 1; while (m < n) m <<= 1; n = m; }   // power of two
    const start = Math.max(0, count - n);
    const len = Math.min(n, count - start);
    if (len < 2) {
      const m0 = Math.floor((fmax || fs / 2) / (fs / n));
      return { f: new Float32Array(m0), mag: new Float32Array(m0), peakF: 0, peakA: 0, df: fs / n };
    }
    const re = new Float64Array(n), im = new Float64Array(n);
    let mean = 0; for (let i = 0; i < len; i++) mean += sig[start + i]; mean /= (len || 1);
    for (let i = 0; i < len; i++) {
      const w = 0.5 - 0.5 * Math.cos(TWO_PI * i / (len - 1));
      re[i] = (sig[start + i] - mean) * w;
    }
    fft(re, im);
    const df = fs / n, m = Math.min(n / 2, Math.floor((fmax || fs / 2) / df));
    const f = new Float32Array(m), mag = new Float32Array(m);
    let peak = 0;
    for (let i = 0; i < m; i++) {
      f[i] = i * df;
      mag[i] = 2 * Math.hypot(re[i], im[i]) / (len * 0.5);   // Hann coherent gain 0.5
      if (i > 0 && mag[i] > mag[peak]) peak = i;
    }
    return { f, mag, peakF: f[peak], peakA: mag[peak], df };
  }

  /** exponential growth rate (1/s) of the envelope over [t0, t1] */
  function growthRate(sig, count, fs, t0, t1) {
    const win = Math.round(fs * 0.01);
    const i0 = Math.max(0, Math.floor(t0 * fs)), i1 = Math.min(count, Math.floor(t1 * fs));
    const xs = [], ys = [];
    for (let i = i0; i + win <= i1; i += win) {
      let ss = 0; for (let j = i; j < i + win; j++) ss += sig[j] * sig[j];
      const rms = Math.sqrt(ss / win);
      if (rms > 1e-9) { xs.push((i + win / 2) / fs); ys.push(Math.log(rms)); }
    }
    if (xs.length < 4) return { sigma: 0, ok: false };
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const n = xs.length;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { sigma: slope, ok: true };
  }

  /**
   * Closed-form critical speed from the negative-damping balance (per stand, gap-opening mode):
   *   c_neg = 4·G/ω²,  G = |∂P/∂σ_b|(E/L)(v_out/h1) [+ front-tension path],  unstable when c_neg > c* = φᵀCφ.
   * Since G ∝ v:  v_crit = v_ref · c* / c_neg(v_ref).  Returns the minimum over stands (m/min) and per-stand values.
   */
  function approxCritical(line) {
    const p = line.p, EL = p.E / p.Lgap;
    const per = [];
    for (let i = 0; i < line.nS; i++) {
      const s = line.stands[i], op = line.op[i];
      const modes = line.modes[i];
      const mode = modes.find(mm => mm.kind === 'gap') || modes.find(mm => mm.antisym && Math.abs(mm.gap) > 0.5) || modes[1];
      if (!mode || !(mode.omega > 0)) { per.push(NaN); continue; }
      const phi = mode.phi, w = mode.omega;
      let ms = 0; for (let j = 0; j < s.n; j++) ms += s.m[j] * phi[j] * phi[j];
      let cs = 0; for (const sp of s.springs) { const pa = phi[sp.a], pb = sp.b < 0 ? 0 : phi[sp.b]; cs += sp.c * (pa - pb) * (pa - pb); }
      const d = 1e-4;
      const fp = bite(op.h1, op.h2 + d, op.sb, op.sf, op.mu, op.R, op.w, op.epsIn, line.mat, op.Rp0, 3).f;
      const fm = bite(op.h1, op.h2 - d, op.sb, op.sf, op.mu, op.R, op.w, op.epsIn, line.mat, op.Rp0, 3).f;
      const dfdh2 = (fp - fm) / (2 * d);
      let G = 0;
      const backSpan = i > 0 || line.reel, frontSpan = i < line.nS - 1 || line.reel;
      const Lb = i > 0 ? p.Lgap : (line.reel ? p.reel.L : 0), Lf = i < line.nS - 1 ? p.Lgap : (line.reel ? p.reel.L : 0);
      if (backSpan && Lb > 0) G += Math.abs(op.dPdsb) * (p.E / Lb) * (op.v2 / op.h1) * 1000;
      if (frontSpan && Lf > 0) G += Math.abs(op.dPdsf) * (p.E / Lf) * op.vR * Math.abs(dfdh2) * 1000;
      const cneg = 4 * G / (w * w);
      per.push(cneg > 0 ? p.vExit * cs / cneg : Infinity);
    }
    const finite = per.filter(v => isFinite(v));
    return { v: finite.length ? Math.min(...finite) : Infinity, perStand: per };
  }

  /** mode kind codes used by eigenAnalysis().kind */
  const MODE_KINDS = [
    { id: 'third', label: '3次（上下ギャップ）' },
    { id: 'fifth', label: '5次（ロール相対）' },
    { id: 'horiz', label: '水平' },
    { id: 'house', label: 'ハウジング伸び' },
    { id: 'tension', label: '張力／リール' },
    { id: 'hf', label: '高次・その他' },
    { id: 'tors', label: 'ねじり（駆動系）' },
  ];

  root.ChatterModel = {
    MODE_KINDS,
    defaultParams, flowStress, bite, buildStand, standModes,
    Line, linearize, balance, eigenAnalysis, approxCritical, torsModes, spindleTorque, Sim, fft, spectrum, growthRate,
  };
})(typeof self !== 'undefined' ? self : globalThis);
