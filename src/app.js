(function () {
  'use strict';
  // fatal-error banner: make startup failures visible instead of a blank page
  const fatal = msg => {
    let b = document.getElementById('fatalBanner');
    if (!b) { b = document.createElement('div'); b.id = 'fatalBanner'; b.setAttribute('role', 'alert'); b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99;background:#d03b3b;color:#fff;padding:10px 14px;border-radius:6px;font:12.5px ui-monospace,monospace;white-space:pre-wrap'; document.body.append(b); }
    b.textContent += (b.textContent ? '\n' : '') + msg;
  };
  window.addEventListener('error', e => fatal(`エラー: ${e.message} (${e.filename || ''}:${e.lineno || ''})`));
  window.addEventListener('unhandledrejection', e => fatal(`未処理の Promise: ${e.reason}`));
  const M = window.ChatterModel;
  if (!M || !window.mlMatrix) {
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      '<div class="card">計算ライブラリ (ml-matrix) を読み込めませんでした。ネットワーク接続を確認して再読み込みしてください。</div>');
    return;
  }

  /* ================================================================
   * helpers
   * ================================================================ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  function svg(tag, attrs, ...kids) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    for (const k of kids.flat(Infinity)) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (x, d = 1) => (isFinite(x) ? x.toFixed(d) : '—');
  const fmtI = x => (isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—');
  const TONF = 9806.65;
  const TWO_PI = 2 * Math.PI;

  const TH = {};
  function refreshTheme() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    Object.assign(TH, {
      ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), line: g('--line'), line2: g('--line-2'),
      panel: g('--panel'), panel2: g('--panel-2'), panel3: g('--panel-3'),
      series: [g('--s1'), g('--s2'), g('--s3'), g('--s4'), g('--s5'), g('--s6')],
      good: g('--good'), warn: g('--warn'), crit: g('--crit'),
      goodInk: g('--good-ink'), warnInk: g('--warn-ink'), critInk: g('--crit-ink'),
      divNeg: g('--div-neg'), divMid: g('--div-mid'), divPos: g('--div-pos'),
      mapStable: g('--map-stable'), mapVert: g('--map-vert'), mapHoriz: g('--map-horiz'), mapTors: g('--map-tors'), mapOther: g('--map-other'),
      steel: g('--steel'), steel2: g('--steel-2'), steel3: g('--steel-3'), strip: g('--strip'), brass: g('--brass'),
      mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
      cond: '"Barlow Condensed", "Arial Narrow", sans-serif',
      sans: '"IBM Plex Sans JP", system-ui, sans-serif',
    });
  }
  refreshTheme();
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { refreshTheme(); redrawStatic(); });
    new MutationObserver(() => { refreshTheme(); redrawStatic(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) { /* ignore */ }

  function fitCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(20, Math.round(r.width)), hh = Math.max(20, Math.round(r.height));
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: hh };
  }
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / e;
    const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * e;
  }
  function hexToRgb(hx) {
    hx = hx.replace('#', '');
    if (hx.length === 3) hx = hx.split('').map(c => c + c).join('');
    const n = parseInt(hx, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  }
  function showTip(tipEl, hostEl, x, y, html) {
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const hr = hostEl.getBoundingClientRect();
    const pr = tipEl.offsetParent ? tipEl.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    let left = hr.left - pr.left + x + 14, top = hr.top - pr.top + y + 14;
    const tw = tipEl.offsetWidth;
    if (left + tw > pr.width - 8) left = hr.left - pr.left + x - tw - 10;
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
  }

  /* ================================================================
   * state
   * ================================================================ */
  const P = M.defaultParams();
  const nS = () => P.h.length;
  const S = {
    line: null, sim: null, eig: null, crit: null, critIt: null,
    selStand: 2, selMode: null, tab: 'overview',
    timeScale: 0.05, scopeWin: 0.5, running: true, halted: false,
    entry: { type: 'none', amp: 20, freq: 50 },
    map: null, maps: null, mapMode: 'single', mapColor: 're', mapFamily: 'all', mapQueue: [], mapStale: true, mapJob: null, specScale: 'thresh', gaugeOverlay: true, coilGuide: 75,
    lastFrame: 0, frame: 0, breaksSeen: 0,
    modeAnimT0: performance.now(),
  };
  const SPG = { hop: 0.02, win: 4096, depth: 20, panels: [], sig: '', ver: 0, nextT: 0, lastT: -1, vmax: 0.1, src: 'gauge', side: 'auto', zoom: null, df: 4.8828125 };
  const SPG_SRC = {
    gauge: { label: '板厚', unit: 'µm', chan: 'gauge' },
    tension: { label: '張力', unit: 'MPa', chan: 'tension' },
    force: { label: '荷重', unit: 'kN', chan: 'force' },
    vib: { label: '振動', unit: 'm/s²', chan: 'vib', zfix: 50 },          // waterfall Z axis fixed at 50 m/s²
    tors: { label: 'ねじり', unit: 'kN·m', chan: 'tq' },
  };
  /** frequency range of the spectrum / spectrogram for the current source (torsion: 0–200 Hz) */
  const specFmax = () => (SPG.src === 'tors' ? 200 : 800);
  /** channels available for the current spectrogram source */
  function spgChannels() {
    const line = S.line, out = [];
    if (SPG.src === 'tension') {
      for (let k = 0; k < line.nS - 1; k++) out.push({ i: k, chan: 'tension', si: k, label: `${k + 1}–${k + 2}`, color: TH.series[k % 6], sw: `var(--s${(k % 6) + 1})` });
      if (line.reel) { out.push({ i: line.nS - 1, chan: 'tension', si: line.nS - 1, label: '入側', color: TH.brass, sw: 'var(--brass)' }); out.push({ i: line.nS, chan: 'tension', si: line.nS, label: '出側', color: TH.brass, sw: 'var(--brass)' }); }
    } else if (SPG.src === 'tors') {
      if (!line.tors) return out;
      for (let i = 0; i < line.nS; i++) out.push({ i, chan: 'tq', si: i, label: `SP${i + 1}`, color: TH.series[i % 6], sw: `var(--s${(i % 6) + 1})` });
    } else if (SPG.src === 'vib') {
      // vertical acceleration of the top WR (solid) and bottom WR (muted) per stand
      for (let i = 0; i < line.nS; i++) {
        const c = TH.series[i % 6], cb = mix(c, TH.ink3, 0.5);
        out.push({ i: 2 * i, chan: 'aWR', si: i, label: `WR上${i + 1}`, color: c, sw: c });
        out.push({ i: 2 * i + 1, chan: 'aBW', si: i, label: `WR下${i + 1}`, color: cb, sw: cb });
      }
    } else {
      const chan = SPG_SRC[SPG.src].chan;
      for (let i = 0; i < line.nS; i++) out.push({ i, chan, si: i, label: `NO.${i + 1}`, color: TH.series[i % 6], sw: `var(--s${(i % 6) + 1})` });
    }
    return out;
  }
  const BANDS = [
    { lo: 100, hi: 200, label: '3rd octave', cls: 'b3', name: '3次オクターブ帯' },
    { lo: 500, hi: 700, label: '5th octave', cls: 'b5', name: '5次オクターブ帯' },
  ];
  const bandOf = f => BANDS.find(b => f >= b.lo && f <= b.hi);

  const PRESETS = {
    '標準 4Hi': () => Object.assign(M.defaultParams(), {}),
    '全 6Hi': () => Object.assign(M.defaultParams(), { standTypes: Array(5).fill('6Hi') }),
    'ブリキ原板': () => Object.assign(M.defaultParams(), {
      h0: 1.8, h: [1.15, 0.72, 0.45, 0.29, 0.22], sigma: [50, 150, 180, 200, 200, 60], zeta: 0.16,
      vExit: 1500, mu: [0.030, 0.028, 0.026, 0.024, 0.022], standTypes: Array(5).fill('6Hi'), width: 900,
    }),
    '単スタンド・リバース': () => Object.assign(M.defaultParams(), {
      h: [1.4], mu: [0.035], sigma: [60, 80], standTypes: ['4Hi'], vExit: 400, reelOn: true,
    }),
    '20Hi ゼンジミア': () => Object.assign(M.defaultParams(), {
      h0: 1.0, h: [0.7], mu: [0.06], sigma: [60, 80], standTypes: ['20Hi'], vExit: 300, reelOn: true,
      width: 1000, barrel: 1400, K: 1300, n: 0.35, kx: 20, reel: { R: 0.7, J: 3000, L: 2500, fv: 5, ft: 1.0 },
    }),
    '厚物・低速': () => Object.assign(M.defaultParams(), {
      h0: 3.2, h: [2.3, 1.65, 1.2, 0.92, 0.8], sigma: [30, 90, 100, 110, 110, 40], vExit: 600, width: 1250,
    }),
  };

  /* ================================================================
   * parameter panel
   * ================================================================ */
  const HELP = {
    vExit: '最終スタンド出側の板速度。質量流一定（v·h = 一定）から各スタンドの板速度とロール周速を決める。張力による負の減衰は速度に比例するため、チャタリングを左右する最重要の運転条件。',
    nStands: '1 は単スタンド（リバース）ミルで、両端リールの張力制御が常に有効。本数を変えると入側板厚と最終板厚の間でスケジュールを等比再配分（1 パス ≤ 40%）。',
    types: '4Hi = WR＋BUR、6Hi = WR＋IMR＋BUR、20Hi = ゼンジミア型クラスタ（1 スタンドのみ）。20Hi は各半分の WR・1 次中間×2・2 次中間×3・バッキング×4 を直列 4 質量に集約。',
    Lgap: 'スタンド間の板長さ。張力剛性 E/L と板厚の伝搬遅れ L/v を決める。短いほど張力変動が速く（E/L 大）、負の減衰が強くなり臨界速度が下がる。',
    width: '板幅。圧延荷重・板バネ剛性 ks・張力による力がすべて幅に比例する。',
    barrel: 'ロール胴長。ロール本体質量の算出に使用（胴部の体積 × 密度 × ネック係数 1.2）。',
    h0: 'ライン入側（焼鈍状態）の板厚。各スタンドの累積ひずみ ε = ln(h₀/h) の基準。',
    h: '各スタンドの出側板厚。単調減少でない値は自動補正される。圧下率が荷重・接触長・先進率を決める。',
    mu: '各スタンドのクーロン摩擦係数。Hill 式の荷重係数と Bland–Ford 中立点に効く。小さすぎると中立点がバイト外に出てスリップ（カードに SKID 表示）。小径ロールほど大きな μ が必要。',
    sigma: '入側・スタンド間・出側の張力応力（MPa）。荷重を下げ（k̄ − σ̄）、先進率を動かす。1 スタンドでは入側=ペイオフ、出側=テンションリールの設定値。',
    zeta: '要素減衰比。各バネ要素に c = 2ζ√(k·m_red) の粘性減衰を与える。実機で最も不確かな量で、臨界速度を合わせる校正代。',
    kHouse: 'ハウジング＋圧下装置（スクリュー／油圧シリンダ）の片側剛性。上下の直列がミル剛性。高いほどギャップ開閉モードの周波数が上がり安定側。',
    kWB: 'WR–BUR 間の接触（Hertz）＋ロール曲げの合成剛性。WR が BUR に対して逆行する 5 次オクターブ帯のモード周波数を決める。',
    kWI: 'WR–IMR 間の接触剛性（6Hi）。', kIB: 'IMR–BUR 間の接触剛性（6Hi）。',
    dWR4: 'WR 径。質量に加え、扁平化半径 R′・接触長 l・先進率に効く。', dBUR4: 'BUR 径。質量の大部分を占め、低次モードの周波数を下げる。',
    dWR6: '6Hi の WR 径。小径ほど高次モードが高くなる。', dIMR6: '6Hi の中間ロール径。', dBUR6: '6Hi の BUR 径。',
    chockWR: 'WR チョック＋軸受の片側質量。ロール質量に 2 個分を加算。', chockIMR: 'IMR チョックの片側質量。', chockBUR: 'BUR チョックの片側質量。',
    K: '流動応力 σ = K·(ε₀+ε)ⁿ の強度係数（平面ひずみで 2/√3 倍）。低炭素鋼 600–700 MPa、ステンレス 1200–1500 MPa。',
    n: '加工硬化指数。低炭素鋼 0.2 前後、ステンレス 0.3–0.4。',
    E: '板のヤング率。張力剛性 E/L に入る。',
    kappa: '動的バイト体積係数。ギャップ速度 ḣ₂ による板の押し出し（v₁h₁ = v₂h₂ + κ·l·ḣ₂）を入側にどれだけ配分するか。0.5 が標準。',
    kx: 'WR チョックの水平（圧延方向）支持剛性（1 本あたり）。20Hi では 1 次中間ロール対による支持。WR 水平モードの周波数 √(k_x/m_WR)/2π の目安を決める。',
    kxI: 'IMR チョックの水平支持剛性（6Hi）。', kxB: 'BUR チョック（20Hi ではバッキングアセンブリ／モノブロック）の水平支持剛性。BUR は質量が大きいので水平モードの周波数はこの値で決まる。',
    kt: 'ロール間接触の接線（摩擦）剛性を法線接触剛性に対する比で与える。転がり接触の固着を仮定した高周波近似。0 にすると各ロールの水平運動は独立になる。',
    eOff: 'WR の出側オフセット。BUR 接触力の水平分力 P·(e+x)/(R_W+R_B) を通して上下荷重変動を水平運動に結合する。20Hi では無効。',
    lam: 'トルクアーム係数。1 ロールあたりの圧延トルク G = λ·l·P。その反力（入側向き）の変動分がバイト合力として WR 水平力に入る。',
    housingOn: 'ハウジングの伸び変形を考慮する。上側の支持を「圧下系剛性 k_sd」→「クロスヘッド質量 m_H」→「支柱伸び剛性 k_post」の直列に分け、静剛性が既存のハウジング剛性 k_h と等しくなるよう k_sd を自動導出する（k_post > k_h が必要）。1 スタンドあたり自由度 +1（水平ありなら +2）。',
    mHouse: '上クロスヘッド＋圧下装置（スクリュー／シリンダ、上チョック座）の有効質量。ハウジング伸びモードの周波数 ≈ √((k_post + k_sd)/m_H)/2π を決める。',
    kPost: 'ハウジング両支柱の伸び剛性（片スタンド）。圧延荷重で支柱が伸びる分。k_h より大きくないと静剛性を保てない（その場合は k_sd を 20·k_h に固定して警告）。',
    torsOn: '駆動系のねじり振動を状態として含める。各スタンドを電動機側慣性（減速機・ピニオン込み、ロール軸換算）–スピンドル（ねじり剛性・減衰・がた）–上下 WR 慣性の 3 慣性系で表し、圧延トルク λ·l·P + ½(σ_b h₁ − σ_f h₂)·w·R を WR の負荷、WR 角速度変動をロール周速→先進率・張力の経路で連成する。1 スタンドあたり状態 +7。',
    torsJM: '電動機ロータ＋減速機＋ピニオンスタンドの慣性をロール軸速度に換算した値（GD²/4 を減速比²で換算）。',
    torsJW: 'WR 1 本の慣性（胴部 ½·m·r² ＋ スピンドルの一部）。',
    torsC: 'スピンドル 1 本のねじり剛性。ユニバーサルスピンドルで 1〜5 MN·m/rad 程度。WR 側のねじり固有振動数 ≈ √(C/J_W)/2π。',
    torsZeta: 'スピンドル要素の減衰比（軸材の内部減衰＋継手の摩擦）。',
    torsBl: 'ギヤ・カップリングのがた（総遊び角、図 9.29 の非線形特性）。0 で無し。圧延トルクによる静的ねじれ角より小さければ通常運転では噛み合ったまま（線形化では剛性 C）、トルクが反転するほど大きく振れると遊び区間でトルクが 0 になる。',
    torsFsc: '電動機速度制御ループ（PI）の帯域。0 でトルク一定（速度制御なし）。高くするとねじり固有振動数と干渉して減衰が変わる（教科書 9.4.4「制御系との共振」）。',
    horizOn: '全ロール（4Hi: 4 本、6Hi: 6 本、20Hi: 8 集約質量）に圧延方向の変位を追加する。ロール間は接触の接線剛性と傾斜接触の幾何剛性 −P/(R_a+R_b) で結合し、各ロールはチョック支持剛性でハウジングに支持される。オフにすると上下変位のみ（状態数が 1 スタンドあたり 2n 減る）。',
    reelOn: '両端リールを状態としてモデル化するか。オフでは入側・出側張力が一定（バイトへの張力フィードバック無し）。',
    reelR: 'コイル半径（平均）。リール周速 = ω·R、張力によるトルク = F·R。', reelJ: 'コイル＋マンドレル＋モータの慣性（リール軸換算）。リール〜板の共振周波数 √(1000·E·A·R²/(J·L))/2π を決める。',
    reelL: 'リールからスタンドまでの板長さ。この区間の張力剛性 E/L。', reelFv: 'リール駆動の速度ループ帯域。高いほどリールが速度源に近づき、張力変動に対する速度のたわみ（ドループ）が減る。',
    reelFt: '張力制御（PI）の帯域。張力偏差を速度指令の補正で戻す速さ。0 で制御なし（速度一定リール）。',
    dWR20: '20Hi の WR 径（50–100 mm）。小径のため扁平化・接触長が小さく荷重も小さい。', dIMR1_20: '1 次中間ロール径（WR を挟む 2 本）。', dIMR2_20: '2 次中間ロール径（3 本、うち 1 本が駆動）。', dBB20: 'バッキングベアリング（バッキングアセンブリ）の外径。各半分 4 本。',
    kWI1_20: 'WR と 1 次中間ロール対の合成接触剛性（各半分、上下方向換算）。', kI1I2_20: '1 次〜2 次中間ロール間の合成接触剛性。', kI2BB20: '2 次中間ロールとバッキングベアリング間の合成剛性。', kHouse20: 'モノブロックハウジング＋サドルの片側剛性。20Hi は非常に剛。',
  };
  const SPEC = [
    { title: '運転', eyebrow: 'OPERATION', open: true, items: [
      { k: 'vExit', label: '出側速度', unit: 'm/min', min: 100, max: 2500, step: 10, big: true },
    ] },
    { title: 'ライン構成', eyebrow: 'LINE', open: true, custom: 'types', items: [
      { k: 'Lgap', label: 'スタンド間距離 L', unit: 'mm', min: 2000, max: 9000, step: 100, slider: true },
      { k: 'width', label: '板幅', unit: 'mm', min: 600, max: 1800, step: 10 },
      { k: 'barrel', label: 'ロール胴長', unit: 'mm', min: 800, max: 2200, step: 10 },
      { k: 'h0', label: '入側板厚 h₀', unit: 'mm', min: 0.8, max: 6, step: 0.05 },
    ] },
    { title: '圧延スケジュール', eyebrow: 'SCHEDULE', open: true, custom: 'schedule' },
    { title: '20Hi クラスタ', eyebrow: 'SENDZIMIR CLUSTER', open: true, visible: () => P.standTypes.includes('20Hi'), items: [
      { k: 'dWR20', label: 'WR 径', unit: 'mm', min: 30, max: 150, step: 5 },
      { k: 'dIMR1_20', label: '1 次中間ロール径', unit: 'mm', min: 60, max: 250, step: 5 },
      { k: 'dIMR2_20', label: '2 次中間ロール径', unit: 'mm', min: 100, max: 400, step: 5 },
      { k: 'dBB20', label: 'バッキングベアリング外径', unit: 'mm', min: 200, max: 700, step: 10 },
      { k: 'kWI1_20', label: 'WR–IMR1 接触剛性（片側）', unit: 'GN/m', min: 2, max: 100, step: 1 },
      { k: 'kI1I2_20', label: 'IMR1–IMR2 接触剛性', unit: 'GN/m', min: 5, max: 150, step: 1 },
      { k: 'kI2BB20', label: 'IMR2–BB 接触剛性', unit: 'GN/m', min: 5, max: 200, step: 1 },
      { k: 'kHouse20', label: 'モノブロック剛性（片側）', unit: 'GN/m', min: 5, max: 150, step: 1, slider: true },
    ] },
    { title: '水平方向（全ロール）', eyebrow: 'HORIZONTAL · ALL ROLLS', open: true, custom: 'horiz' },
    { title: 'ハウジング伸び変形', eyebrow: 'HOUSING STRETCH', open: true, custom: 'housing' },
    { title: '駆動系ねじり振動', eyebrow: 'DRIVE TORSION', open: true, custom: 'tors' },
    { title: 'リール張力制御', eyebrow: 'END REELS', open: true, custom: 'reel' },
    { title: '剛性・減衰', eyebrow: 'STIFFNESS & DAMPING', open: true, items: [
      { k: 'zeta', label: '要素減衰比 ζ', unit: '', min: 0.01, max: 0.3, step: 0.005, slider: true },
      { k: 'kHouse', label: 'ハウジング剛性（片側）', unit: 'GN/m', min: 2, max: 40, step: 0.5, slider: true },
      { k: 'kWB', label: 'WR–BUR 接触剛性 (4Hi)', unit: 'GN/m', min: 5, max: 150, step: 1 },
      { k: 'kWI', label: 'WR–IMR 接触剛性 (6Hi)', unit: 'GN/m', min: 5, max: 150, step: 1 },
      { k: 'kIB', label: 'IMR–BUR 接触剛性 (6Hi)', unit: 'GN/m', min: 5, max: 150, step: 1 },
    ] },
    { title: 'ロール', eyebrow: 'ROLLS', items: [
      { k: 'dWR4', label: 'WR 径 (4Hi)', unit: 'mm', min: 300, max: 800, step: 5 },
      { k: 'dBUR4', label: 'BUR 径 (4Hi)', unit: 'mm', min: 800, max: 1800, step: 10 },
      { k: 'dWR6', label: 'WR 径 (6Hi)', unit: 'mm', min: 250, max: 700, step: 5 },
      { k: 'dIMR6', label: 'IMR 径 (6Hi)', unit: 'mm', min: 350, max: 800, step: 5 },
      { k: 'dBUR6', label: 'BUR 径 (6Hi)', unit: 'mm', min: 800, max: 1800, step: 10 },
      { k: 'chockWR', label: 'WR チョック質量／側', unit: 'kg', min: 0, max: 8000, step: 100 },
      { k: 'chockIMR', label: 'IMR チョック質量／側', unit: 'kg', min: 0, max: 8000, step: 100 },
      { k: 'chockBUR', label: 'BUR チョック質量／側', unit: 'kg', min: 0, max: 20000, step: 250 },
    ] },
    { title: '材料', eyebrow: 'MATERIAL', items: [
      { k: 'K', label: '強度係数 K（σ = K·εⁿ）', unit: 'MPa', min: 200, max: 1600, step: 10 },
      { k: 'n', label: '加工硬化指数 n', unit: '', min: 0.05, max: 0.5, step: 0.01 },
      { k: 'E', label: 'ヤング率 E', unit: 'MPa', min: 50000, max: 400000, step: 1000 },
      { k: 'kappa', label: 'バイト体積係数 κ', unit: '', min: 0, max: 1, step: 0.05 },
    ] },
  ];
  let helpSeq = 0;
  function helpPair(text) {
    if (!text) return { btn: null, div: null };
    const id = 'hlp_' + (helpSeq++);
    const div = h('div', { class: 'help', id });
    div.textContent = text;
    const btn = h('button', { type: 'button', class: 'hlp', 'aria-label': '説明', 'aria-controls': id, 'aria-expanded': 'false', onclick: () => { div.classList.toggle('open'); btn.setAttribute('aria-expanded', String(div.classList.contains('open'))); } }, '?');
    return { btn, div };
  }
  /** label + control row with an optional explanation */
  function paramRow(labelText, forId, control, unit, help, range) {
    const hp = helpPair(help);
    const row = h('div', { class: 'prow' },
      h('label', { for: forId }, labelText, hp.btn),
      h('div', { class: 'val' }, control, unit ? h('span', { class: 'unit' }, unit) : null));
    if (range) row.append(range);
    const frag = document.createDocumentFragment();
    frag.append(row); if (hp.div) frag.append(hp.div);
    return frag;
  }
  const inputs = {};   // key → {num, range}
  let schedInputs = null;
  let typeSegs = [];

  function buildParams() {
    const root = $('#paramGroups');
    root.textContent = '';
    for (const g of SPEC) {
      if (g.visible && !g.visible()) continue;
      const det = h('details', { class: 'pgroup', open: g.open });
      det.append(h('summary', null, h('h3', null, g.title), h('span', { class: 'eyebrow' }, g.eyebrow)));
      const body = h('div', { class: 'body' });
      if (g.custom === 'types') body.append(buildTypes());
      if (g.custom === 'schedule') body.append(buildSchedule());
      if (g.custom === 'reel') body.append(buildReel());
      if (g.custom === 'horiz') body.append(buildHoriz());
      if (g.custom === 'housing') body.append(buildHousing());
      if (g.custom === 'tors') body.append(buildTors());
      for (const it of g.items || []) body.append(buildItem(it));
      det.append(body);
      root.append(det);
    }
    const pr = $('#presets');
    pr.textContent = '';
    for (const [name, fn] of Object.entries(PRESETS)) {
      pr.append(h('button', { type: 'button', onclick: () => { applyPreset(fn()); } }, name));
    }
    syncHelpToggle();
  }
  function syncHelpToggle() {
    const on = aside.classList.contains('show-help');
    const b = $('#btnHelpAll'); if (b) { b.textContent = on ? '説明を隠す' : '説明を表示'; b.setAttribute('aria-pressed', String(on)); }
  }
  function buildItem(it) {
    const id = 'p_' + it.k;
    const num = h('input', { class: 'num', type: 'number', id, min: it.min, max: it.max, step: it.step, value: P[it.k] });
    const onNum = () => {
      const v = parseFloat(num.value);
      if (!isFinite(v)) return;
      P[it.k] = clamp(v, it.min, it.max);
      if (inputs[it.k].range) inputs[it.k].range.value = P[it.k];
      if (it.big) updateBig();
      markDirty(false);
    };
    num.addEventListener('input', onNum);
    num.addEventListener('change', () => { onNum(); num.value = P[it.k]; });
    let range = null;
    if (it.big || it.slider) {
      range = h('input', { type: 'range', id: id + '_r', min: it.min, max: it.max, step: it.step, value: P[it.k], 'aria-label': it.label });
      range.addEventListener('input', () => { P[it.k] = parseFloat(range.value); num.value = P[it.k]; if (it.big) updateBig(); markDirty(false); });
    }
    inputs[it.k] = { num, range, it };
    if (it.big) {
      const wrap = h('div', { class: 'big-speed' });
      const bigv = h('div', { class: 'bigv' }, h('span', { id: 'bigSpeed' }, fmtI(P[it.k])), h('span', { class: 'unit' }, it.unit));
      const hp = helpPair(HELP[it.k]);
      wrap.append(h('div', { class: 'prow' }, h('label', { for: id }, it.label, hp.btn), h('div', { class: 'val' }, num)), bigv, range,
        h('div', { class: 'crit-line' }, h('span', null, '臨界速度（線形）'), h('span', { id: 'critLine' }, '—')));
      if (hp.div) wrap.append(hp.div);
      return wrap;
    }
    return paramRow(it.label, id, num, it.unit, HELP[it.k], range);
  }
  function updateBig() { const e = $('#bigSpeed'); if (e) e.textContent = fmtI(P.vExit); }
  function resizeStands(n) {
    const cur = nS();
    if (n === cur) return;
    let hEnd = P.h[cur - 1];
    // keep every pass at ≤ 40 % reduction (raise the final thickness when there are fewer stands)
    const minRatio = Math.pow(0.6, n);
    if (hEnd / P.h0 < minRatio) hEnd = +(P.h0 * minRatio).toFixed(3);
    const types = P.standTypes.slice(), mus = P.mu.slice(), sig = P.sigma.slice();
    // geometric redistribution of the schedule between h0 and the final thickness
    P.h = Array.from({ length: n }, (_, i) => +(P.h0 * Math.pow(hEnd / P.h0, (i + 1) / n)).toFixed(3));
    P.standTypes = Array.from({ length: n }, (_, i) => types[Math.min(i, types.length - 1)]).map(t => (n > 1 && t === '20Hi') ? '4Hi' : t);
    P.mu = Array.from({ length: n }, (_, i) => mus[Math.min(i, mus.length - 1)]);
    // tensions: entry, interstand × (n−1), exit
    const inter = sig.slice(1, -1);
    const interDefault = Math.max(100, sig[0], sig[sig.length - 1]);
    P.sigma = [sig[0]].concat(Array.from({ length: n - 1 }, (_, i) => (inter.length ? inter[Math.min(i, inter.length - 1)] : interDefault)), [sig[sig.length - 1]]);
    P.reelOn = n === 1;
    S.selStand = Math.min(S.selStand, n - 1); S.selMode = null;
    buildParams();
    markDirty(true);
    if (S.sim) S.sim.reset();
  }
  function buildCountRow() {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'スタンド数' });
    for (const n of [1, 2, 3, 4, 5, 6]) seg.append(h('button', { type: 'button', class: nS() === n ? 'on' : '', onclick: () => resizeStands(n) }, String(n)));
    const hp = helpPair(HELP.nStands);
    const frag = document.createDocumentFragment();
    frag.append(h('div', { class: 'type-row', style: 'margin-bottom:6px' }, h('span', { class: 'who' }, 'スタンド数', hp.btn), seg), hp.div);
    return frag;
  }
  function buildTypes() {
    const box = h('div');
    box.append(buildCountRow());
    const hpT = helpPair(HELP.types);
    box.append(h('div', { class: 'type-row' }, h('span', { class: 'who' }, '型式', hpT.btn)), hpT.div);
    typeSegs = [];
    for (let i = 0; i < nS(); i++) {
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': `No.${i + 1} 型式` });
      const setType = t => {
        const was20 = P.standTypes[i] === '20Hi';
        P.standTypes[i] = t;
        if (was20 || t === '20Hi') buildParams(); else syncTypes();
        markDirty(true);
      };
      const mk = t => h('button', { type: 'button', class: P.standTypes[i] === t ? 'on' : '', onclick: () => setType(t) }, t);
      seg.append(mk('4Hi'), mk('6Hi'));
      if (nS() === 1) seg.append(mk('20Hi'));
      typeSegs.push(seg);
      box.append(h('div', { class: 'type-row' },
        h('span', { class: 'who' }, h('span', { class: 'swatch', style: `background:var(--s${i + 1})` }), `No.${i + 1}`), seg));
    }
    box.append(h('div', { class: 'type-row', style: 'margin-top:6px' },
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { const had = P.standTypes.includes('20Hi'); P.standTypes = P.standTypes.map(() => '4Hi'); if (had) buildParams(); else syncTypes(); markDirty(true); } }, '全て 4Hi'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { const had = P.standTypes.includes('20Hi'); P.standTypes = P.standTypes.map(() => '6Hi'); if (had) buildParams(); else syncTypes(); markDirty(true); } }, '全て 6Hi')));
    return box;
  }
  function syncTypes() {
    typeSegs.forEach((seg, i) => { $$('button', seg).forEach(b => b.classList.toggle('on', b.textContent === P.standTypes[i])); });
  }
  function buildHoriz() {
    const box = h('div');
    const cb = h('input', { type: 'checkbox', id: 'p_horizOn' });
    cb.checked = !!P.horizOn;
    cb.addEventListener('change', () => { P.horizOn = cb.checked; markDirty(true); if (S.sim) S.sim.reset(); });
    const hpOn = helpPair(HELP.horizOn);
    box.append(h('label', { class: 'check', style: 'margin:2px 0 6px;font-size:12.5px;align-items:flex-start' }, cb,
      h('span', null, '全ロールの水平（圧延方向）自由度を含める', hpOn.btn)), hpOn.div);
    const items = [
      { k: 'kx', label: 'WR 水平支持剛性 k_x（1 本あたり）', unit: 'GN/m', min: 0.2, max: 40, step: 0.1 },
      { k: 'kxI', label: 'IMR 水平支持剛性（6Hi）', unit: 'GN/m', min: 0.2, max: 60, step: 0.1 },
      { k: 'kxB', label: 'BUR／バッキング水平支持剛性', unit: 'GN/m', min: 0.5, max: 100, step: 0.5 },
      { k: 'kt', label: '接触の接線剛性比 k_t / k_c', unit: '', min: 0, max: 1, step: 0.05 },
      { k: 'eOff', label: 'WR オフセット e（出側 +）', unit: 'mm', min: -20, max: 20, step: 0.5 },
      { k: 'lam', label: 'トルクアーム係数 λ（G = λ·l·P）', unit: '', min: 0.2, max: 0.7, step: 0.01 },
    ];
    for (const it of items) {
      const id = 'p_' + it.k;
      const num = h('input', { class: 'num', type: 'number', id, min: it.min, max: it.max, step: it.step, value: P[it.k] });
      num.addEventListener('input', () => { const v = parseFloat(num.value); if (isFinite(v)) { P[it.k] = clamp(v, it.min, it.max); markDirty(false); } });
      box.append(paramRow(it.label, id, num, it.unit, HELP[it.k]));
    }
    box.append(h('p', { class: 'fine', style: 'margin-top:4px' }, 'WR に働く水平力 = 前後張力差 ½w(σ_f h₂ − σ_b h₁) ＋ バイト合力 λ·l·P/R′ ＋ オフセット力 ΔP·e/(R_W+R_B)。他のロールは接触を介して連成。WR の水平速度はバイトの並進として入側・出側板速度に加わり、張力に戻る。'))
    return box;
  }
  function buildHousing() {
    const box = h('div');
    const cb = h('input', { type: 'checkbox', id: 'p_housingOn' });
    cb.checked = !!P.housingOn;
    cb.addEventListener('change', () => { P.housingOn = cb.checked; markDirty(true); if (S.sim) S.sim.reset(); });
    const hpOn = helpPair(HELP.housingOn);
    box.append(h('label', { class: 'check', style: 'margin:2px 0 6px;font-size:12.5px;align-items:flex-start' }, cb,
      h('span', null, 'ハウジングの伸び変形（クロスヘッド質量＋支柱剛性）を考慮', hpOn.btn)), hpOn.div);
    const items = [
      { k: 'mHouse', label: 'クロスヘッド有効質量 m_H', unit: 't', min: 5, max: 200, step: 1 },
      { k: 'kPost', label: '支柱伸び剛性 k_post', unit: 'GN/m', min: 5, max: 200, step: 1 },
    ];
    for (const it of items) {
      const id = 'p_' + it.k;
      const num = h('input', { class: 'num', type: 'number', id, min: it.min, max: it.max, step: it.step, value: P[it.k] });
      num.addEventListener('input', () => { const v = parseFloat(num.value); if (isFinite(v)) { P[it.k] = clamp(v, it.min, it.max); markDirty(false); } });
      box.append(paramRow(it.label, id, num, it.unit, HELP[it.k]));
    }
    box.append(h('p', { class: 'fine', id: 'kSdNote', style: 'margin-top:4px' }, ''));
    return box;
  }
  function buildTors() {
    const box = h('div');
    const cb = h('input', { type: 'checkbox', id: 'p_torsOn' });
    cb.checked = !!P.torsOn;
    cb.addEventListener('change', () => { P.torsOn = cb.checked; markDirty(true); if (S.sim) S.sim.reset(); });
    const hpOn = helpPair(HELP.torsOn);
    box.append(h('label', { class: 'check', style: 'margin:2px 0 6px;font-size:12.5px;align-items:flex-start' }, cb,
      h('span', null, '電動機–スピンドル–WR のねじり振動を考慮', hpOn.btn)), hpOn.div);
    const items = [
      { k: 'JM', label: '電動機側慣性 J_M（ロール軸換算）', unit: 'kg·m²', min: 100, max: 100000, step: 100, help: HELP.torsJM },
      { k: 'JW', label: 'WR 慣性 J_W（1 本）', unit: 'kg·m²', min: 1, max: 5000, step: 5, help: HELP.torsJW },
      { k: 'C', label: 'スピンドルねじり剛性 C', unit: 'MN·m/rad', min: 0.1, max: 50, step: 0.1, help: HELP.torsC },
      { k: 'zeta', label: 'スピンドル減衰比', unit: '', min: 0, max: 0.3, step: 0.005, help: HELP.torsZeta },
      { k: 'backlash', label: 'がた Δφ（総遊び角）', unit: 'mrad', min: 0, max: 50, step: 0.5, help: HELP.torsBl },
      { k: 'fsc', label: '速度制御帯域（0 = トルク一定）', unit: 'Hz', min: 0, max: 60, step: 0.5, help: HELP.torsFsc },
    ];
    for (const it of items) {
      const id = 'p_tors_' + it.k;
      const num = h('input', { class: 'num', type: 'number', id, min: it.min, max: it.max, step: it.step, value: P.tors[it.k] });
      num.addEventListener('input', () => { const v = parseFloat(num.value); if (isFinite(v)) { P.tors[it.k] = clamp(v, it.min, it.max); markDirty(false); } });
      box.append(paramRow(it.label, id, num, it.unit, it.help));
    }
    box.append(h('p', { class: 'fine', id: 'torsNote', style: 'margin-top:4px' }, ''));
    return box;
  }
  function renderTorsNote() {
    const el = $('#torsNote'); if (!el) return;
    if (!P.torsOn || !S.line || !S.line.tors) { el.textContent = 'オフ: ロール周速一定（駆動系は剛）。'; return; }
    const tm = S.line.torsModes[0] || [];
    el.textContent = `ねじり固有振動数: ${tm.map(mm => `${mm.f.toFixed(1)} Hz（${mm.antisym ? '上下逆相' : '同相'}）`).join('、')}。静的ねじれ角 ${(S.line.op[0].delta0 * 1e3).toFixed(1)} mrad（No.1）。`;
  }
  function renderKsdNote() {
    const el = $('#kSdNote'); if (!el) return;
    const kH = P.standTypes.includes('20Hi') ? P.kHouse20 : P.kHouse;
    if (!P.housingOn) { el.textContent = 'オフ: 上側支持は k_h 一本のバネ（従来モデル）。'; return; }
    if (P.kPost > 1.05 * kH) el.textContent = `圧下系剛性 k_sd = ${(P.kPost * kH / (P.kPost - kH)).toFixed(1)} GN/m（k_sd と k_post の直列 = k_h ${kH} GN/m を保持）`;
    else el.textContent = `警告: k_post ≤ k_h（${kH} GN/m）のため静剛性を保てない。k_sd = ${20 * kH} GN/m に固定。k_post を大きくすること。`;
  }
  function buildReel() {
    const box = h('div');
    const one = nS() === 1;
    if (one) P.reelOn = true;
    const cb = h('input', { type: 'checkbox', id: 'p_reelOn' });
    cb.checked = !!P.reelOn; cb.disabled = one;
    cb.addEventListener('change', () => { P.reelOn = cb.checked; markDirty(true); if (S.sim) S.sim.reset(); });
    const hpOn = helpPair(HELP.reelOn);
    box.append(h('label', { class: 'check', style: 'margin:2px 0 6px;font-size:12.5px;align-items:flex-start' }, cb,
      h('span', null, one ? '単スタンド: ペイオフ／テンションリールの張力制御を考慮（常時）' : '両端リール（ペイオフ／テンションリール）の張力動特性を考慮', hpOn.btn)), hpOn.div);
    const items = [
      { k: 'R', label: 'コイル半径 R', unit: 'm', min: 0.25, max: 1.2, step: 0.05, help: HELP.reelR },
      { k: 'J', label: 'コイル＋マンドレル慣性 J', unit: 'kg·m²', min: 100, max: 50000, step: 100, help: HELP.reelJ },
      { k: 'L', label: 'リール〜スタンド距離', unit: 'mm', min: 500, max: 20000, step: 100, help: HELP.reelL },
      { k: 'fv', label: '速度ループ帯域', unit: 'Hz', min: 0.5, max: 30, step: 0.5, help: HELP.reelFv },
      { k: 'ft', label: '張力ループ帯域（0 = 制御なし）', unit: 'Hz', min: 0, max: 10, step: 0.1, help: HELP.reelFt },
    ];
    for (const it of items) {
      const id = 'p_reel_' + it.k;
      const num = h('input', { class: 'num', type: 'number', id, min: it.min, max: it.max, step: it.step, value: P.reel[it.k] });
      num.addEventListener('input', () => { const v = parseFloat(num.value); if (isFinite(v)) { P.reel[it.k] = clamp(v, it.min, it.max); markDirty(false); } });
      box.append(paramRow(it.label, id, num, it.unit, it.help));
    }
    box.append(h('p', { class: 'fine', style: 'margin-top:4px' }, 'リールは速度ループ付き駆動、張力 PI が速度指令を補正。張力偏差 → 入側/出側の板速度差 → E/L で積分、が両端でも働く。'));
    return box;
  }
  function buildSchedule() {
    const box = h('div');
    const tbl = h('table', { class: 'sched' });
    const hpH = helpPair(HELP.h), hpM = helpPair(HELP.mu);
    tbl.append(h('tr', null, h('th', null, 'Stand'), h('th', null, 'h₂ mm', hpH.btn), h('th', null, 'μ', hpM.btn)));
    schedInputs = { h: [], mu: [], sigma: [] };
    for (let i = 0; i < nS(); i++) {
      const hi = h('input', { class: 'num', type: 'number', min: 0.05, max: 10, step: 0.01, value: P.h[i], 'aria-label': `No.${i + 1} 出側板厚` });
      const mi = h('input', { class: 'num', type: 'number', min: 0.005, max: 0.3, step: 0.001, value: P.mu[i], 'aria-label': `No.${i + 1} 摩擦係数` });
      hi.addEventListener('input', () => { const v = parseFloat(hi.value); if (isFinite(v) && v > 0) { P.h[i] = v; markDirty(false); } });
      mi.addEventListener('input', () => { const v = parseFloat(mi.value); if (isFinite(v) && v > 0) { P.mu[i] = clamp(v, 0.005, 0.3); markDirty(false); } });
      schedInputs.h.push(hi); schedInputs.mu.push(mi);
      tbl.append(h('tr', null, h('td', null, h('span', { class: 'swatch', style: `background:var(--s${i + 1});margin-right:5px` }), `No.${i + 1}`), h('td', null, hi), h('td', null, mi)));
    }
    box.append(tbl, hpH.div, hpM.div);
    const n = nS();
    const tg = h('div', { class: 'tension-grid', style: `--nt:${n + 1}` });
    const names = ['入側'].concat(Array.from({ length: n - 1 }, (_, k) => `${k + 1}–${k + 2}`), ['出側']);
    for (let i = 0; i < n + 1; i++) {
      const inp = h('input', { class: 'num', type: 'number', min: 0, max: 600, step: 5, value: P.sigma[i], 'aria-label': `張力 ${names[i]} MPa` });
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (isFinite(v)) { P.sigma[i] = clamp(v, 0, 600); markDirty(false); } });
      schedInputs.sigma.push(inp);
      tg.append(h('div', { class: 'cell' }, h('label', null, names[i]), inp));
    }
    const hpS = helpPair(HELP.sigma);
    box.append(h('div', { class: 'fine', style: 'margin-top:8px' }, '張力 σ（MPa）', hpS.btn), hpS.div, tg);
    return box;
  }
  function syncInputs() {
    for (const [k, o] of Object.entries(inputs)) { o.num.value = P[k]; if (o.range) o.range.value = P[k]; }
    for (let i = 0; i < nS(); i++) { schedInputs.h[i].value = P.h[i]; schedInputs.mu[i].value = P.mu[i]; }
    for (let i = 0; i < nS() + 1; i++) schedInputs.sigma[i].value = P.sigma[i];
    syncTypes(); updateBig();
  }
  function applyPreset(q) {
    for (const k of Object.keys(q)) P[k] = Array.isArray(q[k]) ? q[k].slice() : q[k];
    S.selStand = Math.min(S.selStand, nS() - 1); S.selMode = null;
    buildParams();
    markDirty(true);
    if (S.sim) S.sim.reset();
  }
  function sanitize() {
    // every numeric entry must be finite
    for (let i = 0; i < P.sigma.length; i++) if (!isFinite(P.sigma[i])) { P.sigma[i] = 100; if (schedInputs.sigma[i]) schedInputs.sigma[i].value = 100; }
    for (let i = 0; i < P.mu.length; i++) if (!isFinite(P.mu[i]) || P.mu[i] <= 0) { P.mu[i] = 0.03; if (schedInputs.mu[i]) schedInputs.mu[i].value = 0.03; }
    for (const k of ['R', 'J', 'L', 'fv', 'ft']) if (!isFinite(P.reel[k])) P.reel[k] = M.defaultParams().reel[k];
    for (const k of ['JM', 'JW', 'C', 'zeta', 'backlash', 'fsc']) if (!isFinite(P.tors[k])) P.tors[k] = M.defaultParams().tors[k];
    // exit thicknesses must decrease monotonically
    let prev = P.h0;
    for (let i = 0; i < nS(); i++) {
      if (!(P.h[i] < prev * 0.995)) { P.h[i] = +(prev * 0.9).toFixed(3); schedInputs.h[i].value = P.h[i]; }
      prev = P.h[i];
    }
  }

  /* ================================================================
   * compute pipeline
   * ================================================================ */
  let dirty = true, structDirty = true;
  function markDirty(struct) { dirty = true; if (struct) structDirty = true; }

  function rebuild() {
    sanitize();
    S.line = new M.Line(P);
    if (!S.sim) S.sim = new M.Sim(S.line, { noise: 2000, histSec: 3, entry: S.entry, breakAmp: 150 });
    else S.sim.bind(S.line);
    S.eig = M.eigenAnalysis(S.line, { fmin: 5 });
    S.critIt = critGen();
    S.crit = null;
    S.mapStale = true;
    if (structDirty) {
      buildSchematic(); buildStandUI(); structDirty = false; S.selMode = null;
      // stand count / type changed: previous maps refer to stands that may no longer exist
      S.map = null; S.maps = null; S.mapJob = null; S.mapQueue = [];
      if (worker) worker.postMessage({ cancel: true });
      $('#mapProgress').textContent = '';
    }
    if (S.tab === 'stability') scheduleMap();
    renderStandCards();
    renderHeroMeta();
    renderOverview();
    renderModal();
    renderKsdNote();
    renderTorsNote();
    updateStatusPill();
  }
  function* critGen() {
    const base = Object.assign({}, P, { h: P.h.slice(), mu: P.mu.slice(), sigma: P.sigma.slice(), standTypes: P.standTypes.slice() });
    const f = v => M.eigenAnalysis(new M.Line(Object.assign({}, base, { vExit: v })), { fmin: 5 }).maxRe;
    let lo = 60, hi = 3000;
    if (f(lo) > 0) return { v: lo, kind: 'below' };
    yield;
    if (f(hi) < 0) return { v: hi, kind: 'above' };
    yield;
    for (let i = 0; i < 11; i++) {
      const m = 0.5 * (lo + hi);
      if (f(m) > 0) hi = m; else lo = m;
      yield;
    }
    return { v: 0.5 * (lo + hi), kind: 'ok' };
  }
  function critStep() {
    if (!S.critIt || S.halted) return;
    for (let i = 0; i < 2; i++) {
      const r = S.critIt.next();
      if (r.done) { S.critIt = null; S.crit = r.value; renderCritLine(); renderVerdict(); break; }
    }
  }
  function critText() {
    if (!S.crit) return S.halted ? '停止中' : '計算中…';
    if (S.crit.kind === 'below') return '< 60 m/min';
    if (S.crit.kind === 'above') return '> 3000 m/min';
    return fmtI(S.crit.v) + ' m/min';
  }
  function renderCritLine() { const e = $('#critLine'); if (e) e.textContent = critText(); }

  /* ================================================================
   * schematic (hero)
   * ================================================================ */
  const SCH = { W: 1000, H: 440, padX: 70, reelPadX: 120, scale: 0.068, yP: 190 };
  const SCH_PRESETS = {
    standard: { W: 1000, H: 420, padX: 70, reelPadX: 120, scale: 0.068, yP: 185, fit: false, oneLine: false },
    compact: { W: 1000, H: 320, padX: 66, reelPadX: 120, scale: 0.05, yP: 142, fit: false, oneLine: false },
    // wider, shorter canvas: viewBox height is fitted to the drawn stands, one label line per stand
    dense: { W: 1300, H: 240, padX: 100, reelPadX: 170, scale: 0.034, yP: 120, fit: true, oneLine: true },
  };
  const isDense = () => document.documentElement.getAttribute('data-density') === 'dense';
  function applyDensity(mode, initial) {
    mode = Object.prototype.hasOwnProperty.call(SCH_PRESETS, mode) ? mode : 'compact';
    document.documentElement.setAttribute('data-density', mode);
    $$('.density button').forEach(b => b.classList.toggle('on', b.dataset.density === mode));
    Object.assign(SCH, SCH_PRESETS[mode]);
    try { localStorage.setItem('chatterlab.density', mode); } catch (e) { /* ignore */ }
    if (!initial) { structDirty = true; markDirty(true); }
  }
  const stripPx = hmm => 2 + 5 * hmm / P.h0;
  function buildSchematic() {
    const el = $('#mill');
    el.textContent = '';
    const { W, H, padX, reelPadX, scale, yP } = SCH;
    el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let yMin = yP - 30, yMax = yP + 20;                    // drawn extent, used when SCH.fit
    const line = S.line, nS = line.nS;
    const xs = [];
    const px = line.reel ? Math.max(padX, reelPadX) : padX;
    if (nS === 1) xs.push(W / 2);
    else for (let i = 0; i < nS; i++) xs.push(px + i * (W - 2 * px) / (nS - 1));
    S.sch = { xs, rolls: [], segs: [], tens: [], labels: [], stripT: [], reels: [], tensEnd: [] };
    const defs = svg('defs');
    defs.append(svg('linearGradient', { id: 'gRoll', x1: 0, y1: 0, x2: 1, y2: 0 },
      svg('stop', { offset: '0', 'stop-color': TH.steel3 }), svg('stop', { offset: '0.5', 'stop-color': TH.steel2 }), svg('stop', { offset: '1', 'stop-color': TH.steel3 })));
    el.append(defs);
    const gStrip = svg('g'); el.append(gStrip);
    const gStands = svg('g'); el.append(gStands);
    // strip stubs + segments
    for (let i = 0; i <= nS; i++) {
      const poly = svg('polygon', { fill: TH.strip, class: 'strip-seg' });
      gStrip.append(poly);
      S.sch.segs.push(poly);
    }
    for (let i = 0; i < nS; i++) {
      const st = line.stands[i], n = st.n;
      const rad = st.radii.map(r => r * scale);
      const tpx = stripPx(line.op[i].h2);
      const cy = new Array(n);
      const j0 = st.housing ? 1 : 0;                      // first real roll
      let y = yP - tpx / 2 - rad[st.iTW]; cy[st.iTW] = y;
      for (let j = st.iTW - 1; j >= j0; j--) { y -= rad[j + 1] + rad[j]; cy[j] = y; }
      y = yP + tpx / 2 + rad[st.iBW]; cy[st.iBW] = y;
      for (let j = st.iBW + 1; j < n; j++) { y += rad[j - 1] + rad[j]; cy[j] = y; }
      const HH = 14;                                       // crosshead rect height
      let top = cy[j0] - rad[j0] - 12, bot = cy[n - 1] + rad[n - 1] + 12, hw = rad[j0] + 16;
      let clusterPos = null;
      if (st.cluster) {
        clusterPos = clusterLayout(st, xs[i], yP, tpx);
        const flat = clusterPos.flat();
        top = Math.min(...flat.map(c => c.y - c.r)) - 12; bot = Math.max(...flat.map(c => c.y + c.r)) + 12;
        hw = Math.max(...flat.map(c => Math.abs(c.x - xs[i]) + c.r)) + 14;
      }
      if (st.housing) { cy[0] = top - HH / 2 - 2; top -= HH + 8; }
      const g = svg('g');
      g.append(svg('rect', { x: xs[i] - hw, y: top, width: 2 * hw, height: bot - top, rx: 5, fill: TH.panel2, stroke: TH.line, 'stroke-width': 1.2 }));
      // screw-down / cylinder block (fixed) or moving crosshead (housing-stretch option)
      if (!st.housing) g.append(svg('rect', { x: xs[i] - 16, y: top - 14, width: 32, height: 16, rx: 2, fill: TH.steel2, stroke: TH.steel, 'stroke-width': 1 }));
      // rolls (one DOF may be drawn as several circles: 20Hi cluster)
      const rolls = [];
      const mkCircle = (cx0, cy0, r0) => {
        const grp = svg('g');
        grp.append(svg('circle', { cx: cx0, cy: cy0, r: r0, fill: 'url(#gRoll)', stroke: TH.steel, 'stroke-width': r0 > 8 ? 1.2 : 0.8 }));
        grp.append(svg('line', { x1: cx0, y1: cy0, x2: cx0 + r0 * 0.82, y2: cy0, stroke: TH.steel, 'stroke-width': 1, opacity: 0.8 }));
        if (r0 > 6) grp.append(svg('circle', { cx: cx0, cy: cy0, r: Math.min(2.4, r0 * 0.2), fill: TH.steel }));
        g.append(grp);
        return grp;
      };
      const mkCrosshead = (cx0, cy0, w0) => {
        const grp = svg('g');
        grp.append(svg('rect', { x: cx0 - w0 / 2, y: cy0 - HH / 2, width: w0, height: HH, rx: 2, fill: TH.steel2, stroke: TH.steel, 'stroke-width': 1 }));
        grp.append(svg('rect', { x: cx0 - 6, y: cy0 - HH / 2 - 8, width: 12, height: 8, fill: TH.steel, opacity: 0.8 }));
        g.append(grp);
        return grp;
      };
      if (st.cluster) {
        for (let j = 0; j < n; j++) {
          if (st.housing && j === 0) { rolls.push({ grps: [{ g: mkCrosshead(xs[i], cy[0], 2 * hw - 24), cx: xs[i], cy: cy[0], dir: 0 }], r: HH / 2, top: true, Rmm: 1 }); continue; }
          const pos = clusterPos[j - j0];
          const grps = pos.map(c => ({ g: mkCircle(c.x, c.y, c.r), cx: c.x, cy: c.y, dir: c.dir }));
          rolls.push({ grps, r: pos[0].r, top: j < (n + j0) / 2, Rmm: st.radii[j] });
        }
      } else {
        for (let j = 0; j < n; j++) {
          if (st.housing && j === 0) { rolls.push({ grps: [{ g: mkCrosshead(xs[i], cy[0], 2 * hw - 24), cx: xs[i], cy: cy[0], dir: 0 }], r: HH / 2, top: true, Rmm: 1 }); continue; }
          const grp = mkCircle(xs[i], cy[j], rad[j]);
          rolls.push({ grps: [{ g: grp, cx: xs[i], cy: cy[j], dir: j < (n + j0) / 2 ? 1 : -1 }], r: rad[j], top: j < (n + j0) / 2, Rmm: st.radii[j] });
        }
      }
      S.sch.rolls.push(rolls);
      // labels
      if (SCH.oneLine) {
        const lh = svg('tspan', { dx: 8, 'font-family': TH.mono, 'font-size': 11, 'font-weight': 400, fill: TH.ink2, 'letter-spacing': 0 }, '');
        g.append(svg('text', { x: xs[i], y: bot + 18, 'text-anchor': 'middle', 'font-family': TH.cond, 'font-size': 14, 'font-weight': 700, fill: TH.series[i], 'letter-spacing': 1 }, `No.${i + 1}`,
          svg('tspan', { dx: 5, 'font-size': 10.5, 'font-weight': 600, fill: TH.ink3, 'letter-spacing': 1.5 }, st.type.toUpperCase()), lh));
        S.sch.labels.push({ h: lh });
        yMax = Math.max(yMax, bot + 22);
      } else {
        const no = svg('text', { x: xs[i], y: bot + 22, 'text-anchor': 'middle', 'font-family': TH.cond, 'font-size': 16, 'font-weight': 700, fill: TH.series[i], 'letter-spacing': 1 }, `No.${i + 1}`,
          svg('tspan', { dx: 6, 'font-size': 11.5, 'font-weight': 600, fill: TH.ink3, 'letter-spacing': 1.5 }, st.type.toUpperCase()));
        const lh = svg('text', { x: xs[i], y: bot + 38, 'text-anchor': 'middle', 'font-family': TH.mono, 'font-size': 11, fill: TH.ink2 }, '');
        g.append(no, lh);
        S.sch.labels.push({ h: lh });
        yMax = Math.max(yMax, bot + 42);
      }
      yMin = Math.min(yMin, top - 16);                     // screw-down block / crosshead cap
      gStands.append(g);
    }
    // tension labels between stands
    for (let k = 0; k < nS - 1; k++) {
      const xm = 0.5 * (xs[k] + xs[k + 1]);
      const t = svg('text', { x: xm, y: yP - 16, 'text-anchor': 'middle', 'font-family': TH.mono, 'font-size': 11, fill: TH.ink2 }, '');
      el.append(t);
      S.sch.tens.push(t);
    }
    if (line.reel) {
      // payoff reel (left) and tension reel (right): strip leaves / arrives at the top tangent
      const rr = Math.min(40, line.p.reel.R * 1000 * scale);
      const mk = (cx, label) => {
        const cy = yP + rr;
        const grp = svg('g');
        grp.append(svg('circle', { cx, cy, r: rr, fill: 'url(#gRoll)', stroke: TH.steel, 'stroke-width': 1.4 }));
        grp.append(svg('circle', { cx, cy, r: rr * 0.3, fill: TH.panel2, stroke: TH.steel, 'stroke-width': 1 }));
        grp.append(svg('line', { x1: cx, y1: cy, x2: cx + rr * 0.85, y2: cy, stroke: TH.steel, 'stroke-width': 1, opacity: 0.8 }));
        gStands.append(grp);
        gStands.append(svg('text', { x: cx, y: cy + rr + 16, 'text-anchor': 'middle', 'font-family': TH.cond, 'font-size': 10.5, 'font-weight': 600, fill: TH.ink3, 'letter-spacing': 1.5 }, label));
        const t = svg('text', { x: 0, y: yP - 16, 'text-anchor': 'middle', 'font-family': TH.mono, 'font-size': 11, fill: TH.ink2 }, '');
        el.append(t);
        return { grp, cx, cy, r: rr, Rm: line.p.reel.R, txt: t };
      };
      const rl = mk(34, 'PAYOFF REEL'), rt = mk(W - 34, 'TENSION REEL');
      rl.txt.setAttribute('x', 0.5 * (34 + xs[0])); rt.txt.setAttribute('x', 0.5 * (xs[nS - 1] + W - 34));
      S.sch.reels = [rl, rt];
      yMax = Math.max(yMax, rl.cy + rl.r + 20);
    } else {
      // flow direction arrowheads on the entry / exit stubs
      el.append(svg('polygon', { points: `${W - 8},${yP} ${W - 20},${yP - 7} ${W - 20},${yP + 7}`, fill: TH.ink3 }));
      el.append(svg('polygon', { points: `${22},${yP} ${10},${yP - 7} ${10},${yP + 7}`, fill: TH.ink3 }));
    }
    if (SCH.fit) {
      const y0 = Math.floor(yMin - 4);
      el.setAttribute('viewBox', `0 ${y0} ${W} ${Math.ceil(yMax + 4) - y0}`);
    }
    updateSchematicLabels();
    animateSchematic(true);
  }
  function updateSchematicLabels() {
    if (!S.sch) return;
    const line = S.line;
    for (let i = 0; i < line.nS; i++) {
      const o = line.op[i];
      S.sch.labels[i].h.textContent = `${o.h2.toFixed(2)} mm · ${fmtI(o.P0 / TONF)} t`;
    }
  }
  /** 1-2-3-4 Sendzimir cluster positions (px) per lumped DOF, top→bottom order [BB, I2, I1, WR, WR, I1, I2, BB] */
  function clusterLayout(st, cx, yP, tpx) {
    const sc = SCH.scale * 2.6;
    const t = st.iTW;
    const rW = st.radii[t] * sc, rI1 = st.radii[t - 1] * sc, rI2 = st.radii[t - 2] * sc, rB = st.radii[t - 3] * sc;
    const half = (sign) => {
      const d = sign;   // -1 = upper half (y decreasing), +1 = lower half
      const wr = { x: cx, y: yP + d * (tpx / 2 + rW), r: rW, dir: -d };
      const a1 = 30 * Math.PI / 180;
      const i1 = [-1, 1].map(s => ({ x: wr.x + s * (rW + rI1) * Math.sin(a1), y: wr.y + d * (rW + rI1) * Math.cos(a1), r: rI1, dir: d }));
      const i2c = { x: cx, y: i1[0].y + d * Math.sqrt(Math.max(0, (rI1 + rI2) ** 2 - (i1[0].x - cx) ** 2)), r: rI2, dir: -d };
      const a2 = 66 * Math.PI / 180;
      const i2 = [i2c].concat([0, 1].map(k => { const s = k ? 1 : -1; return { x: i1[k].x + s * (rI1 + rI2) * Math.sin(a2), y: i1[k].y + d * (rI1 + rI2) * Math.cos(a2), r: rI2, dir: -d }; }));
      const a3 = 24 * Math.PI / 180, a4 = 70 * Math.PI / 180;
      const bb = [-1, 1].map(s => ({ x: i2c.x + s * (rI2 + rB) * Math.sin(a3), y: i2c.y + d * (rI2 + rB) * Math.cos(a3), r: rB, dir: d }))
        .concat([1, 2].map(k => { const s = k === 1 ? -1 : 1; return { x: i2[k].x + s * (rI2 + rB) * Math.sin(a4), y: i2[k].y + d * (rI2 + rB) * Math.cos(a4), r: rB, dir: d }; }));
      return { wr, i1, i2, bb };
    };
    const up = half(-1), lo = half(1);
    return [up.bb, up.i2, up.i1, [up.wr], [lo.wr], lo.i1, lo.i2, lo.bb];
  }
  const GAIN = 0.12, DEVGAIN = 0.06;
  function animateSchematic(force) {
    if (!S.sch || !S.sim) return;
    const sim = S.sim, line = S.line, xs = S.sch.xs, yP = SCH.yP;
    let q = 0, qx = 0;
    const t = sim.t;
    for (let i = 0; i < line.nS; i++) {
      const rolls = S.sch.rolls[i], op = line.op[i], st = line.stands[i];
      for (let j = 0; j < rolls.length; j++) {
        const r = rolls[j];
        const dy = clamp(-sim.disp[q++] * 1e6 * GAIN, -26, 26);
        let dx = 0;
        if (st.nx) dx = clamp(sim.dispX[qx + j] * 1e6 * GAIN, -26, 26);
        const w = op.vR / r.Rmm;                       // rad/s
        let angBase = (w * t * 180 / Math.PI) % 360;
        if (line.tors && (j === st.iTW || j === st.iBW)) angBase += clamp(sim.dispT[2 * i + (j === st.iTW ? 0 : 1)] * 400 * 180 / Math.PI, -60, 60);   // twist ×400
        for (const c of r.grps) c.g.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) rotate(${(c.dir * angBase).toFixed(1)} ${c.cx} ${c.cy})`);
      }
      qx += st.nx;
    }
    // strip polygons
    const K = 40;
    for (let s = 0; s <= line.nS; s++) {
      const poly = S.sch.segs[s];
      let x0, x1, hmm, buf = null, ptr = 0;
      const reels = S.sch.reels;
      const rw = k => S.sch.rolls[k][line.stands[k].iTW].r * 0.35;
      if (s === 0) { x0 = reels.length ? reels[0].cx : 20; x1 = xs[0] - rw(0); hmm = P.h0; }
      else if (s === line.nS) { x0 = xs[s - 1] + rw(s - 1); x1 = reels.length ? reels[1].cx : SCH.W - 18; hmm = line.op[s - 1].h2; }
      else {
        x0 = xs[s - 1] + rw(s - 1);
        x1 = xs[s] - rw(s);
        hmm = line.op[s - 1].h2; buf = sim.buf[s]; ptr = sim.ptr[s];
      }
      const base = stripPx(hmm);
      const topPts = [], botPts = [];
      let big = 0;
      for (let k = 0; k <= K; k++) {
        const f = k / K;
        const x = x0 + (x1 - x0) * f;
        let dev = 0;
        if (buf) {
          const L = buf.length;
          const idx = (ptr - Math.round(f * (L - 1)) + L) % L;
          dev = (buf[idx] - hmm) * 1000;             // µm
          if (Math.abs(dev) > big) big = Math.abs(dev);
        } else if (s === line.nS) {
          // exit strip: last samples of stand-5 gauge history
          const n = sim.count;
          if (n > 2) {
            const back = Math.round(f * Math.min(n - 1, sim.fs * line.p.Lgap / line.op[s - 1].v2));
            const idx = (sim.w - 1 - back + sim.histLen * 4) % sim.histLen;
            dev = sim.chan.gauge[s - 1][idx];
            if (Math.abs(dev) > big) big = Math.abs(dev);
          }
        }
        const tpx = Math.max(0.8, base + clamp(dev * DEVGAIN, -12, 12));
        topPts.push(`${x.toFixed(1)},${(yP - tpx / 2).toFixed(2)}`);
        botPts.push(`${x.toFixed(1)},${(yP + tpx / 2).toFixed(2)}`);
      }
      poly.setAttribute('points', topPts.join(' ') + ' ' + botPts.reverse().join(' '));
      poly.setAttribute('fill', big > S.coilGuide ? TH.crit : big > S.coilGuide / 3 ? TH.warn : TH.strip);
    }
    // reels: rotation + end-span tension text
    if (line.reel && S.sch.reels.length) {
      const [rl, rt] = S.sch.reels;
      const vp = line.op[0].v1 / 1000, vt = line.op[line.nS - 1].v2 / 1000;   // m/s
      const wp = (vp / rl.Rm + sim.y[line.Rr + 1]) * t * 180 / Math.PI, wt = (vt / rt.Rm + sim.y[line.Rr + 4]) * t * 180 / Math.PI;
      rl.grp.setAttribute('transform', `rotate(${(wp % 360).toFixed(1)} ${rl.cx} ${rl.cy})`);
      rt.grp.setAttribute('transform', `rotate(${(wt % 360).toFixed(1)} ${rt.cx} ${rt.cy})`);
      const sb = P.sigma[0] + sim.y[line.Rr], sf = P.sigma[line.nS] + sim.y[line.Rr + 3];
      rl.txt.textContent = `${sb.toFixed(0)} MPa`; rt.txt.textContent = `${sf.toFixed(0)} MPa`;
      rl.txt.setAttribute('fill', Math.abs(sim.y[line.Rr]) > 0.3 * P.sigma[0] ? TH.critInk : TH.ink2);
      rt.txt.setAttribute('fill', Math.abs(sim.y[line.Rr + 3]) > 0.3 * P.sigma[line.nS] ? TH.critInk : TH.ink2);
    }
    // live tension text
    for (let k = 0; k < line.nS - 1; k++) {
      const v = P.sigma[k + 1] + sim.y[line.T + k];
      const el = S.sch.tens[k];
      el.textContent = `${v.toFixed(0)} MPa`;
      el.setAttribute('fill', Math.abs(sim.y[line.T + k]) > 0.3 * P.sigma[k + 1] ? TH.critInk : TH.ink2);
    }
  }

  /* ================================================================
   * stand cards / hero meta / status pill
   * ================================================================ */
  function renderStandCards() {
    const box = $('#standCards');
    box.textContent = '';
    const line = S.line, eig = S.eig;
    box.style.setProperty('--ns', line.nS);
    const crit = eig.critical;
    const dense = isDense();
    const lbl = (full, short) => dense ? h('span', { title: full }, short) : h('span', null, full);
    for (let i = 0; i < line.nS; i++) {
      const o = line.op[i], st = line.stands[i];
      const gapMode = line.modes[i].find(m => m.kind === 'gap') || line.modes[i][1];
      const card = h('div', { class: 'stand', style: `--c:var(--s${i + 1})` },
        h('div', { class: 'no' }, `No.${i + 1}`, h('span', { class: 'ty' }, st.type.toUpperCase())),
        h('div', { class: 'kv' },
          lbl('板厚', '板厚'), h('span', null, `${o.h1.toFixed(2)}→${o.h2.toFixed(2)}`),
          lbl('荷重', '荷重'), h('span', null, `${fmt(o.P0 / 1e6, 2)} MN`),
          h('span', { class: 'opt' }, '圧下率'), h('span', { class: 'opt' }, `${fmt(o.r * 100, 1)} %`),
          h('span', { class: 'opt' }, '先進率'), h('span', { class: 'opt' }, `${fmt(o.f0 * 100, 2)} %`),
          h('span', { class: 'opt' }, '速度'), h('span', { class: 'opt' }, `${fmtI(o.v2 * 0.06)} m/min`),
          lbl('ギャップ開閉モード', '開閉'), h('span', null, `${fmtI(gapMode.f)} Hz`),
          lbl('板厚偏差 rms', '偏差'), h('span', { class: 'live', 'data-i': i }, '—'),
        ));
      if (o.skid) card.append(h('span', { class: 'flag skid', title: '中立点がバイト外：スリップ' }, 'SKID'));
      else if (crit && crit.re > 0 && crit.domStand === i) card.append(h('span', { class: 'flag', title: '最不安定モードの主スタンド' }, 'CHATTER'));
      box.append(card);
    }
  }
  function renderHeroMeta() {
    const line = S.line;
    const hEnd = P.h[nS() - 1];
    const red = 1 - hEnd / P.h0;
    $('#heroTitle').textContent = `${P.h0.toFixed(2)} → ${hEnd.toFixed(2)} mm · ${fmtI(P.vExit)} m/min · ${nS()} スタンド`;
    $('#heroMeta').innerHTML =
      `<span>総圧下率 <b>${fmt(red * 100, 1)} %</b></span>` +
      `<span>板幅 <b>${P.width} mm</b></span>` +
      `<span>L <b>${P.Lgap} mm</b></span>` +
      (line.tau.length ? `<span>伝搬時間 1→2 <b>${fmt(line.tau[0] * 1000, 0)} ms</b></span>` : '') +
      (line.reel ? `<span>リール張力制御 <b>${P.reel.ft > 0 ? P.reel.ft + ' Hz' : 'なし'}</b></span>` : '') +
      `<span>破断 <b id="heroBreaks">${S.sim ? S.sim.breaks : 0}</b> 回</span>`;
  }
  function verdictClass() {
    const re = S.eig.maxRe;
    return re > 0 ? 'crit' : re > -6 ? 'warn' : 'good';
  }
  function updateStatusPill() {
    const pill = $('#statusPill');
    const c = S.eig.critical;
    const cls = verdictClass();
    pill.className = 'pill ' + cls;
    const word = cls === 'crit' ? '不安定' : cls === 'warn' ? '限界付近' : '安定';
    $('.pill-text', pill).textContent = `${word} · ${fmtI(c.f)} Hz · Re λ ${c.re >= 0 ? '+' : ''}${fmt(c.re, 1)} /s`;
  }

  /* ================================================================
   * overview tab
   * ================================================================ */
  function renderOverview() {
    const line = S.line;
    const tbl = $('#opTable');
    tbl.textContent = '';
    tbl.append(h('tr', null, ...['Stand', '型式', 'h₁ → h₂ mm', '圧下率', '荷重 MN', 'tonf', '先進率', 'v out m/min', 'R′/R', 'l mm', 'k̄ MPa', 'ks GN/m', 'τ ms'].map(t => h('th', null, t))));
    for (let i = 0; i < line.nS; i++) {
      const o = line.op[i];
      tbl.append(h('tr', null,
        h('td', { class: 't' }, h('span', { class: 'sw', style: `background:var(--s${i + 1})` }), `No.${i + 1}`),
        h('td', { class: 't' }, line.stands[i].type),
        h('td', null, `${o.h1.toFixed(2)} → ${o.h2.toFixed(2)}`),
        h('td', null, fmt(o.r * 100, 1) + ' %'),
        h('td', null, fmt(o.P0 / 1e6, 2)),
        h('td', null, fmtI(o.P0 / TONF)),
        h('td', null, fmt(o.f0 * 100, 2) + ' %' + (o.skid ? ' ⚠' : '')),
        h('td', null, fmtI(o.v2 * 0.06)),
        h('td', null, fmt(o.Rp0 / o.R, 2)),
        h('td', null, fmt(o.l0, 1)),
        h('td', null, fmtI(o.kbar)),
        h('td', null, fmt(o.ks / 1e9, 1)),
        h('td', null, i < line.nS - 1 ? fmtI(line.tau[i] * 1000) : '—'),
      ));
    }
    renderVerdict();
    drawModeBands();
  }
  function renderVerdict() {
    const box = $('#verdict');
    const c = S.eig.critical, cls = verdictClass();
    const word = cls === 'crit' ? '不安定' : cls === 'warn' ? '限界付近' : '安定';
    const sub = cls === 'crit'
      ? `最不安定モード ${fmtI(c.f)} Hz は Re λ = +${fmt(c.re, 1)} /s で成長。板厚偏差は約 ${fmt(Math.log(10) / c.re * 1000, 0)} ms で 10 倍になる。`
      : cls === 'warn' ? `最も減衰の小さいモード ${fmtI(c.f)} Hz の等価減衰比は ${fmt(c.zeta * 100, 2)} %。速度をわずかに上げると不安定化。`
        : `最も減衰の小さいモード ${fmtI(c.f)} Hz でも等価減衰比 ${fmt(c.zeta * 100, 2)} %。`;
    const band = bandOf(c.f);
    const margin = S.crit && S.crit.kind === 'ok' ? S.crit.v - P.vExit : null;
    box.textContent = '';
    box.append(
      h('div', { class: 'verdict-top' }, h('div', { class: 'verdict-badge ' + cls }, word), h('div', { class: 'verdict-sub' }, sub)),
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '臨界速度（線形化モデル）'), h('div', { class: 'v' }, S.crit ? (S.crit.kind === 'ok' ? fmtI(S.crit.v) : critText()) : '…', S.crit && S.crit.kind === 'ok' ? h('span', { class: 'u' }, 'm/min') : null)),
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '速度余裕'), h('div', { class: 'v' }, margin == null ? '—' : (margin >= 0 ? '+' : '') + fmtI(margin), h('span', { class: 'u' }, 'm/min'))),
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '最不安定モード'), h('div', { class: 'v' }, fmtI(c.f), h('span', { class: 'u' }, 'Hz' + (band ? ' · ' + band.name : '')))),
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '成長率 Re λ ／ 等価減衰比'), h('div', { class: 'v' }, (c.re >= 0 ? '+' : '') + fmt(c.re, 1), h('span', { class: 'u' }, `/s · ζeq ${fmt(c.zeta * 100, 2)} %`))),
        h('div', { class: 'kpi wide' }, h('div', { class: 'k' }, `参加度（スタンドごとのギャップ振幅）· 主スタンド No.${c.domStand + 1}`),
          h('div', { class: 'partic' }, ...c.gapAmp.map((a, i) => h('div', { class: 'b', style: `--c:var(--s${i + 1})` }, h('i', { style: `height:${Math.max(2, a * 100).toFixed(0)}%` }), h('span', null, `No.${i + 1}`))))),
      ));
  }

  // ---- mode bands chart (all stands)
  const bandsHit = [];
  function drawModeBands() {
    const c = $('#modeBands');
    const { ctx, w, h: H } = fitCanvas(c);
    ctx.clearRect(0, 0, w, H);
    const line = S.line;
    const left = 52, right = 16, top = 26, bottom = 28;
    const fmin = S.line.tors ? 10 : 40, fmax = 1500;
    const xOf = f => left + (Math.log10(f) - Math.log10(fmin)) / (Math.log10(fmax) - Math.log10(fmin)) * (w - left - right);
    const rowH = (H - top - bottom) / line.nS;
    // bands
    for (const b of BANDS) {
      ctx.fillStyle = TH.panel3;
      ctx.fillRect(xOf(b.lo), top - 6, xOf(b.hi) - xOf(b.lo), H - top - bottom + 6);
      ctx.fillStyle = TH.ink3; ctx.font = `600 10.5px ${TH.cond}`; ctx.textAlign = 'center';
      ctx.fillText(b.label.toUpperCase(), 0.5 * (xOf(b.lo) + xOf(b.hi)), top - 10);
    }
    // grid
    ctx.strokeStyle = TH.line2; ctx.lineWidth = 1;
    ctx.fillStyle = TH.ink3; ctx.font = `11px ${TH.mono}`; ctx.textAlign = 'center';
    for (const f of (S.line.tors ? [10, 20, 50, 100, 200, 300, 500, 700, 1000] : [50, 100, 200, 300, 500, 700, 1000])) {
      const x = Math.round(xOf(f)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, H - bottom); ctx.stroke();
      ctx.fillText(String(f), x, H - bottom + 14);
    }
    ctx.fillText('Hz', w - right, H - bottom + 14);
    bandsHit.length = 0;
    for (let i = 0; i < line.nS; i++) {
      const y = top + rowH * (i + 0.5);
      ctx.strokeStyle = TH.line2; ctx.beginPath(); ctx.moveTo(left, Math.round(y) + 0.5); ctx.lineTo(w - right, Math.round(y) + 0.5); ctx.stroke();
      ctx.fillStyle = TH.series[i]; ctx.font = `700 13px ${TH.cond}`; ctx.textAlign = 'left';
      ctx.fillText(`No.${i + 1}`, 8, y + 4);
      for (const m of line.modes[i].concat(line.torsModes[i] || [])) {
        if (m.f < fmin || m.f > fmax) continue;
        const x = xOf(m.f);
        ctx.beginPath();
        if (m.kind === 'tors') { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x - 7, y + 6); ctx.closePath(); ctx.fillStyle = TH.series[i]; ctx.fill(); ctx.strokeStyle = TH.panel; ctx.lineWidth = 2; ctx.stroke(); }
        else if (m.kind === 'horiz') { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fillStyle = TH.series[i]; ctx.fill(); ctx.strokeStyle = TH.panel; ctx.lineWidth = 2; ctx.stroke(); }
        else if (m.kind === 'house') { ctx.rect(x - 5.5, y - 5.5, 11, 11); ctx.fillStyle = TH.panel; ctx.fill(); ctx.strokeStyle = TH.series[i]; ctx.lineWidth = 1.8; ctx.stroke(); }
        else {
          ctx.arc(x, y, 5.5, 0, TWO_PI);
          if (m.kind === 'gap' || m.kind === 'gap-hi') { ctx.fillStyle = TH.series[i]; ctx.fill(); ctx.strokeStyle = TH.panel; ctx.lineWidth = 2; ctx.stroke(); }
          else { ctx.fillStyle = TH.panel; ctx.fill(); ctx.strokeStyle = TH.series[i]; ctx.lineWidth = 1.8; ctx.stroke(); }
        }
        bandsHit.push({ x, y, i, m });
      }
    }
    // coupled critical mode line
    const cf = S.eig.critical.f;
    if (cf > fmin && cf < fmax) {
      const x = Math.round(xOf(cf)) + 0.5;
      ctx.strokeStyle = S.eig.maxRe > 0 ? TH.crit : TH.ink2; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, top - 4); ctx.lineTo(x, H - bottom); ctx.stroke();
      ctx.fillStyle = S.eig.maxRe > 0 ? TH.critInk : TH.ink2; ctx.font = `11px ${TH.mono}`; ctx.textAlign = 'left';
      ctx.fillText(`${fmtI(cf)} Hz`, x + 4, H - bottom - 4);
    }
  }
  (function bindBandsHover() {
    const c = $('#modeBands'), tip = $('#tipBands');
    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 14;
      for (const p of bandsHit) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
      if (!best) { tip.hidden = true; return; }
      showTip(tip, c, x, y, `No.${best.i + 1} · ${best.m.f.toFixed(1)} Hz<br>${best.m.label}`);
    });
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
  })();

  /* ================================================================
   * modal tab
   * ================================================================ */
  function renderModal() {
    const line = S.line;
    if (S.selStand >= line.nS) { S.selStand = line.nS - 1; S.selMode = null; }
    const chips = $('#standChips');
    chips.textContent = '';
    for (let i = 0; i < line.nS; i++) {
      chips.append(h('button', { class: 'chip' + (i === S.selStand ? ' on' : ''), type: 'button', onclick: () => { S.selStand = i; S.selMode = null; renderModal(); } },
        h('span', { class: 'swatch', style: `background:var(--s${i + 1})` }), `NO.${i + 1}`, h('span', { style: 'opacity:.7;font-weight:500' }, line.stands[i].type)));
    }
    const modes = line.modes[S.selStand].concat(line.torsModes[S.selStand] || []);
    if (S.selMode == null || S.selMode >= modes.length) {
      const gi = modes.findIndex(m => m.kind === 'gap');
      S.selMode = gi >= 0 ? gi : 1;
    }
    const list = $('#modeList');
    list.textContent = '';
    modes.forEach((m, k) => {
      const band = m.kind === 'tors' ? null : bandOf(m.f);
      list.append(h('button', { class: 'mode' + (k === S.selMode ? ' on' : ''), type: 'button', onclick: () => { S.selMode = k; renderModal(); } },
        h('div', { class: 'f' }, m.f < 100 ? fmt(m.f, 1) : fmtI(m.f), h('small', null, 'Hz')),
        h('div', { class: 'lab' }, m.label),
        h('span', { class: 'band ' + (band ? band.cls : m.kind === 'tors' ? 'bt' : '') }, band ? band.label.toUpperCase() : m.kind === 'tors' ? 'TORSION' : `MODE ${k + 1}`)));
    });
    const m = modes[S.selMode];
    $('#modeTitle').textContent = `No.${S.selStand + 1} · ${fmt(m.f, 1)} Hz · ${m.label}`;
    buildStackSvg();
    renderPhi(m);
    renderConsts();
    renderCoupled();
  }
  function renderPhi(m) {
    const st = S.line.stands[S.selStand];
    const box = $('#phiBars');
    box.textContent = '';
    box.append(h('div', { class: 'eyebrow', style: 'margin-bottom:2px' }, 'MODE VECTOR φ'));
    const names = m.kind === 'tors' ? ['電動機', 'WR上', 'WR下'] : st.names;
    names.forEach((nm, j) => {
      const v = m.phi[j];
      const bar = h('div', { class: 'bar' }, h('i', { style: v >= 0 ? `left:50%;width:${(v * 50).toFixed(1)}%` : `right:50%;width:${(-v * 50).toFixed(1)}%` }));
      box.append(h('div', { class: 'r' }, h('span', { class: 'n' }, nm), bar, h('span', { class: 'v' }, (v >= 0 ? '+' : '') + v.toFixed(2))));
    });
  }
  function renderConsts() {
    const st = S.line.stands[S.selStand], op = S.line.op[S.selStand];
    const box = $('#modelConsts');
    box.textContent = '';
    const items = [];
    st.m.forEach((mm, j) => items.push([`m${j + 1} ${st.short[j]}`, `${(mm / 1000).toFixed(1)} t`]));
    items.push(['k_h ハウジング（静）', `${st.cluster ? P.kHouse20 : P.kHouse} GN/m`]);
    if (st.housing) { items.push(['k_post 支柱伸び', `${(st.kPost / 1e9).toFixed(1)} GN/m`]); items.push(['k_sd 圧下系', `${(st.kSd / 1e9).toFixed(1)} GN/m`]); items.push(['m_H クロスヘッド', `${P.mHouse} t`]); }
    if (st.type === '4Hi') items.push(['k WR–BUR', `${P.kWB} GN/m`]);
    else if (st.type === '6Hi') { items.push(['k WR–IMR', `${P.kWI} GN/m`]); items.push(['k IMR–BUR', `${P.kIB} GN/m`]); }
    else { items.push(['k WR–IMR1', `${P.kWI1_20} GN/m`]); items.push(['k IMR1–IMR2', `${P.kI1I2_20} GN/m`]); items.push(['k IMR2–BB', `${P.kI2BB20} GN/m`]); }
    items.push(['k_s 板 (−∂P/∂h₂)', `${(op.ks / 1e9).toFixed(1)} GN/m`]);
    if (st.nx) { items.push(['k_x WR 水平支持', `${P.kx} GN/m`]); items.push(['k_xB BUR 水平支持', `${P.kxB} GN/m`]); items.push(['k_t/k_c 接線剛性比', `${P.kt}`]); }
    items.push(['ζ 要素減衰', `${P.zeta}`]);
    if (S.line.tors) { items.push(['J_M 電動機側', `${P.tors.JM} kg·m²`]); items.push(['J_W WR', `${P.tors.JW} kg·m²`]); items.push(['C スピンドル', `${P.tors.C} MN·m/rad`]); items.push(['G₀ 圧延トルク／ロール', `${(op.G0 / 1e3).toFixed(1)} kN·m`]); }
    items.push(['det(K − ω²M)', '= 0']);
    for (const [k, v] of items) box.append(h('div', null, k + ' ', h('b', null, v)));
  }
  // ---- roll stack SVG (selected stand) with springs
  const STK = { W: 340, scale: 0.105 };
  function buildStackSvg() {
    const el = $('#stackSvg');
    el.textContent = '';
    const st = S.line.stands[S.selStand], n = st.n;
    const rad = st.radii.map(r => r * (st.cluster ? 0.3 : STK.scale));
    const total = rad.reduce((a, r) => a + 2 * r, 0) + 18;
    const H = total + 120;
    el.setAttribute('viewBox', `0 0 ${STK.W} ${H}`);
    const cx = 120, yP = H / 2;
    const cy = new Array(n);
    const j0 = st.housing ? 1 : 0;
    let y = yP - 9 - rad[st.iTW]; cy[st.iTW] = y;
    for (let j = st.iTW - 1; j >= j0; j--) { y -= rad[j + 1] + rad[j]; cy[j] = y; }
    y = yP + 9 + rad[st.iBW]; cy[st.iBW] = y;
    for (let j = st.iBW + 1; j < n; j++) { y += rad[j - 1] + rad[j]; cy[j] = y; }
    if (st.housing) { cy[0] = cy[1] - rad[1] - 30; rad[0] = 10; }
    const gTop = cy[0] - rad[0] - 34, gBot = cy[n - 1] + rad[n - 1] + 34;
    // ground hatches
    for (const gy of [gTop, gBot]) {
      el.append(svg('line', { x1: cx - 80, y1: gy, x2: cx + 80, y2: gy, stroke: TH.ink2, 'stroke-width': 2 }));
      for (let x = cx - 78; x < cx + 80; x += 10) el.append(svg('line', { x1: x, y1: gy, x2: x - 7, y2: gy + (gy === gTop ? -8 : 8), stroke: TH.ink3, 'stroke-width': 1 }));
    }
    // strip
    const strip = svg('rect', { x: cx - 100, y: yP - 4, width: 200, height: 8, fill: TH.strip, rx: 1 });
    el.append(strip);
    const springs = [];   // {el, a: index|-1(top ground)|-2(bottom ground), b, label}
    const mkSpring = (label, cls) => {
      const g = svg('g');
      const pl = svg('polyline', { fill: 'none', stroke: cls === 'strip' ? TH.brass : TH.ink2, 'stroke-width': cls === 'strip' ? 2 : 1.5, 'stroke-linejoin': 'round' });
      const tx = svg('text', { 'font-family': TH.mono, 'font-size': 11, fill: cls === 'strip' ? TH.brass : TH.ink3 }, label);
      g.append(pl, tx); el.append(g);
      return { pl, tx };
    };
    let kIdx = 1;
    for (const sp of st.springs) {
      const s = mkSpring(`k${kIdx++}`, sp.b < 0 ? 'ground' : 'contact');
      springs.push(Object.assign(s, { a: sp.a, b: sp.b < 0 ? (sp.a < n / 2 ? -1 : -2) : sp.b }));
    }
    // order: place strip spring label as ks
    const ss = mkSpring('ks', 'strip'); springs.push(Object.assign(ss, { a: st.iTW, b: st.iBW, strip: true }));
    const rolls = [];
    for (let j = 0; j < n; j++) {
      const g = svg('g');
      if (st.housing && j === 0) {
        g.append(svg('rect', { x: cx - 60, y: cy[j] - 10, width: 120, height: 20, rx: 3, fill: TH.steel2, stroke: TH.steel, 'stroke-width': 1.5 }));
      } else {
        g.append(svg('circle', { cx, cy: cy[j], r: rad[j], fill: TH.steel2, stroke: TH.steel, 'stroke-width': 1.5 }));
        g.append(svg('line', { x1: cx, y1: cy[j], x2: cx + rad[j] * 0.85, y2: cy[j], stroke: TH.steel, 'stroke-width': 1.2, opacity: 0.9 }));
        g.append(svg('circle', { cx, cy: cy[j], r: 3, fill: TH.steel }));
      }
      const lx = (st.housing && j === 0) ? cx + 66 : cx + rad[j] + 10;
      g.append(svg('text', { x: lx, y: cy[j] + 4, 'font-family': TH.cond, 'font-size': 13, 'font-weight': 600, fill: TH.ink2, 'letter-spacing': 1 }, `m${j + 1} ${st.short[j]}`));
      g.append(svg('text', { x: lx, y: cy[j] + 18, 'font-family': TH.mono, 'font-size': 10.5, fill: TH.ink3 }, `${(st.m[j] / 1000).toFixed(1)} t`));
      el.append(g);
      rolls.push({ g, cy: cy[j], r: rad[j] });
    }
    // horizontal chock supports (left wall); tangential roll–roll contacts are not drawn
    const hsprings = [];
    if (st.nx) {
      const xWall = 16;
      const sup = st.hsprings.filter(hs => hs.b < 0);
      if (sup.length) {
        const ys = sup.map(hs => cy[hs.a]);
        const yT = Math.min(...ys) - 26, yB = Math.max(...ys) + 26;
        el.append(svg('line', { x1: xWall, y1: yT, x2: xWall, y2: yB, stroke: TH.ink2, 'stroke-width': 2 }));
        for (let yy = yT + 2; yy < yB; yy += 10) el.append(svg('line', { x1: xWall, y1: yy, x2: xWall - 7, y2: yy + 7, stroke: TH.ink3, 'stroke-width': 1 }));
        for (const hs of sup) {
          const s = mkSpring(st.short[hs.a] === 'WR' ? 'kx' : st.short[hs.a] === 'IMR' ? 'kxI' : 'kxB', 'contact');
          hsprings.push(Object.assign(s, { j: hs.a, xWall }));
        }
      }
    }
    S.stack = { el, rolls, springs, hsprings, cx, gTop, gBot, yP, strip, n, st };
    drawStackFrame(0);
  }
  function zigzag(x, y1, y2, amp, nz) {
    const pts = [`${x},${y1}`];
    const len = y2 - y1;
    const lead = Math.min(6, Math.abs(len) * 0.15) * Math.sign(len);
    pts.push(`${x},${y1 + lead}`);
    const inner = len - 2 * lead;
    for (let i = 0; i < nz; i++) {
      const t = (i + 0.5) / nz;
      pts.push(`${x + (i % 2 ? -amp : amp)},${y1 + lead + inner * t}`);
    }
    pts.push(`${x},${y2 - lead}`, `${x},${y2}`);
    return pts.join(' ');
  }
  function zigzagH(y, x1, x2, amp, nz) {
    const pts = [`${x1},${y}`];
    const len = x2 - x1;
    const lead = Math.min(6, Math.abs(len) * 0.15) * Math.sign(len);
    pts.push(`${x1 + lead},${y}`);
    const inner = len - 2 * lead;
    for (let i = 0; i < nz; i++) { const t = (i + 0.5) / nz; pts.push(`${x1 + lead + inner * t},${y + (i % 2 ? -amp : amp)}`); }
    pts.push(`${x2 - lead},${y}`, `${x2},${y}`);
    return pts.join(' ');
  }
  function drawStackFrame(t) {
    const stk = S.stack; if (!stk) return;
    const all = S.line.modes[S.selStand].concat(S.line.torsModes[S.selStand] || []);
    const m = all[S.selMode] || all[0];
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const A = reduce ? 0 : 15 * Math.sin(TWO_PI * 0.55 * t);
    const st = stk.st;
    if (m.kind === 'tors') {
      // torsional mode: rotate the work rolls (spokes) by the modal angle; everything else at rest
      stk.rolls.forEach((r, j) => {
        const ang = j === st.iTW ? m.phi[1] * A * 2 : j === st.iBW ? m.phi[2] * A * 2 : 0;
        r.g.setAttribute('transform', ang ? `rotate(${ang.toFixed(2)} ${stk.cx} ${r.cy})` : '');
      });
      const yT0 = stk.rolls[st.iTW].cy + stk.rolls[st.iTW].r, yB0 = stk.rolls[st.iBW].cy - stk.rolls[st.iBW].r;
      stk.strip.setAttribute('y', yT0 - 1); stk.strip.setAttribute('height', Math.max(2, yB0 - yT0 + 2));
      for (const sp of stk.springs) {
        let y1, y2, x = stk.cx;
        if (sp.strip) { x = stk.cx - 40; y1 = stk.rolls[sp.a].cy; y2 = stk.rolls[sp.b].cy; }
        else if (sp.b === -1) { y1 = stk.gTop; y2 = stk.rolls[sp.a].cy - stk.rolls[sp.a].r; }
        else if (sp.b === -2) { y1 = stk.rolls[sp.a].cy + stk.rolls[sp.a].r; y2 = stk.gBot; }
        else { x = stk.cx - 40; y1 = stk.rolls[sp.a].cy; y2 = stk.rolls[sp.b].cy; }
        sp.pl.setAttribute('points', zigzag(x, y1, y2, 7, 6));
        sp.tx.setAttribute('x', x - 30); sp.tx.setAttribute('y', 0.5 * (y1 + y2) + 4);
      }
      for (const hs of stk.hsprings || []) { const r = stk.rolls[hs.j]; hs.pl.setAttribute('points', zigzagH(r.cy, hs.xWall, stk.cx - r.r, 6, 6)); hs.tx.setAttribute('x', hs.xWall + 4); hs.tx.setAttribute('y', r.cy - 9); }
      return;
    }
    const dy = stk.rolls.map((r, j) => -m.phi[j] * A);
    const dx = stk.rolls.map((r, j) => (st.nx ? m.phi[st.n + j] * A : 0));
    stk.rolls.forEach((r, j) => r.g.setAttribute('transform', `translate(${dx[j].toFixed(2)} ${dy[j].toFixed(2)})`));
    for (const hs of stk.hsprings || []) {
      const r = stk.rolls[hs.j];
      const y = r.cy + dy[hs.j];
      hs.pl.setAttribute('points', zigzagH(y, hs.xWall, stk.cx - r.r + dx[hs.j], 6, 6));
      hs.tx.setAttribute('x', hs.xWall + 4); hs.tx.setAttribute('y', y - 9);
    }
    // strip: between WRs
    const yT = stk.rolls[st.iTW].cy + stk.rolls[st.iTW].r + dy[st.iTW];
    const yB = stk.rolls[st.iBW].cy - stk.rolls[st.iBW].r + dy[st.iBW];
    stk.strip.setAttribute('y', Math.min(yT, yB) - 1);
    stk.strip.setAttribute('height', Math.max(2, yB - yT + 2));
    // springs
    for (const sp of stk.springs) {
      let y1, y2, x = stk.cx;
      if (sp.strip) { x = stk.cx - 40; y1 = stk.rolls[sp.a].cy + dy[sp.a]; y2 = stk.rolls[sp.b].cy + dy[sp.b]; }
      else if (sp.b === -1) { y1 = stk.gTop; y2 = stk.rolls[sp.a].cy - stk.rolls[sp.a].r + dy[sp.a]; x = stk.cx; }
      else if (sp.b === -2) { y1 = stk.rolls[sp.a].cy + stk.rolls[sp.a].r + dy[sp.a]; y2 = stk.gBot; x = stk.cx; }
      else { x = stk.cx - 40; y1 = stk.rolls[sp.a].cy + dy[sp.a]; y2 = stk.rolls[sp.b].cy + dy[sp.b]; }
      sp.pl.setAttribute('points', zigzag(x, y1, y2, 7, 6));
      sp.tx.setAttribute('x', x - 30); sp.tx.setAttribute('y', 0.5 * (y1 + y2) + 4);
    }
  }
  function renderCoupled() {
    const tbl = $('#coupledTable');
    tbl.textContent = '';
    tbl.append(h('tr', null, ...['#', 'f Hz', 'Re λ 1/s', 'ζeq %', '帯域', '主スタンド', '参加度 No.1–5'].map(t => h('th', null, t))));
    const modes = S.eig.modes.filter(m => m.f > 5).slice(0, 10);
    modes.forEach((m, k) => {
      const band = bandOf(m.f);
      tbl.append(h('tr', { class: m.re > 0 ? 'hot' : '' },
        h('td', { class: 't' }, String(k + 1)),
        h('td', null, fmt(m.f, 1)),
        h('td', null, (m.re >= 0 ? '+' : '') + fmt(m.re, 2)),
        h('td', null, fmt(m.zeta * 100, 2)),
        h('td', { class: 't' }, band ? band.name : m.kind === 6 ? 'ねじり' : m.kind === 2 ? '水平' : m.kind === 3 ? 'ハウジング伸び' : m.kind === 4 ? '張力／リール' : '—'),
        h('td', { class: 't' }, h('span', { class: 'sw', style: `background:var(--s${m.domStand + 1})` }), `No.${m.domStand + 1}`),
        h('td', null, h('span', { class: 'bars' }, ...m.gapAmp.map((a, i) => h('i', { style: `height:${Math.max(1, a * 14).toFixed(1)}px;--c:var(--s${i + 1})` })))),
      ));
    });
  }

  /* ================================================================
   * live tab
   * ================================================================ */
  function bindLiveControls() {
    $('#timeScale').addEventListener('change', e => { S.timeScale = parseFloat(e.target.value); });
    $('#scopeWin').addEventListener('change', e => { S.scopeWin = parseFloat(e.target.value); });
    const upEntry = () => {
      S.entry.type = $('#entryType').value;
      S.entry.amp = parseFloat($('#entryAmp').value) || 0;
      S.entry.freq = parseFloat($('#entryFreq').value) || 1;
      S.sim.entry = S.entry;
    };
    ['entryType', 'entryAmp', 'entryFreq'].forEach(id => $('#' + id).addEventListener('input', upEntry));
    $('#noiseLvl').addEventListener('input', e => { S.sim.noise = (parseFloat(e.target.value) || 0) * 1000; });
    $('#breakAmp').addEventListener('input', e => { S.sim.breakAmp = parseFloat(e.target.value) || 150; });
    $('#coilGuide').addEventListener('input', e => { const v = parseFloat(e.target.value); if (isFinite(v) && v > 0) { S.coilGuide = v; try { localStorage.setItem('chatterlab.coilGuide', String(v)); } catch (err) { /* ignore */ } } });
    try { const cg = parseFloat(localStorage.getItem('chatterlab.coilGuide')); if (isFinite(cg) && cg > 0) { S.coilGuide = cg; $('#coilGuide').value = cg; } } catch (e) { /* ignore */ }
    $('#delayOn').addEventListener('change', e => { S.sim.delay = e.target.checked; });
    $('#btnPause').addEventListener('click', e => { S.running = !S.running; e.target.textContent = S.running ? '一時停止' : '再開'; });
    $('#btnHalt').addEventListener('click', () => setHalted(!S.halted));
    $('#btnReset').addEventListener('click', () => { S.sim.reset(); S.sim.breaks = 0; $('#heroBreaks') && ($('#heroBreaks').textContent = '0'); });
    setScale = m => {
      S.specScale = m;
      $$('#specScale button').forEach(b => b.classList.toggle('on', b.dataset.scale === m));
      $('#specNote').textContent = m === 'thresh' ? '直近 0.41 s · Hann 窓 · 上端 = 破断しきい値（板厚のみ）' : '直近 0.41 s · Hann 窓 · 自動スケール';
      updateWfNote();
      try { localStorage.setItem('chatterlab.specScale', m); } catch (e) { /* ignore */ }
    };
    $$('#specScale button').forEach(b => b.addEventListener('click', () => setScale(b.dataset.scale)));
    setOverlay = v => {
      S.gaugeOverlay = v;
      $$('#gaugeMode button').forEach(b => b.classList.toggle('on', (b.dataset.mode === 'overlay') === v));
      try { localStorage.setItem('chatterlab.gaugeOverlay', v ? '1' : '0'); } catch (e) { /* ignore */ }
    };
    $$('#gaugeMode button').forEach(b => b.addEventListener('click', () => setOverlay(b.dataset.mode === 'overlay')));
    try { setOverlay(localStorage.getItem('chatterlab.gaugeOverlay') !== '0'); } catch (e) { setOverlay(true); }
    let savedScale = 'thresh';
    try { savedScale = localStorage.getItem('chatterlab.specScale') || 'thresh'; } catch (e) { /* ignore */ }
    setScale(savedScale === 'auto' ? 'auto' : 'thresh');
  }
  /** UI pieces that depend on the number of stands */
  function buildStandUI() {
    const n = nS();
    const kc = $('#kickChips');
    kc.textContent = '';
    for (let i = 0; i < n; i++) kc.append(h('button', { class: 'chip', type: 'button', onclick: () => { S.sim.kick(i, 0.004); } }, h('span', { class: 'swatch', style: `background:var(--s${i + 1})` }), `NO.${i + 1}`));
    const kx = $('#kickXChips');
    kx.textContent = '';
    for (let i = 0; i < n; i++) kx.append(h('button', { class: 'chip', type: 'button', disabled: !P.horizOn, onclick: () => { S.sim.kickX(i, 0.01); } }, h('span', { class: 'swatch', style: `background:var(--s${i + 1})` }), `NO.${i + 1}`));
    const kt = $('#kickTChips');
    kt.textContent = '';
    for (let i = 0; i < n; i++) kt.append(h('button', { class: 'chip', type: 'button', disabled: !P.torsOn, onclick: () => { S.sim.kickT(i, 0.1); } }, h('span', { class: 'swatch', style: `background:var(--s${i + 1})` }), `NO.${i + 1}`));
    const lg = $('#liveLegend');
    lg.textContent = '';
    for (let i = 0; i < n; i++) lg.append(h('span', null, h('span', { class: 'swatch', style: `background:var(--s${i + 1})` }), `No.${i + 1}`));
    for (let k = 0; k < n - 1; k++) lg.append(h('span', null, h('span', { class: 'swatch', style: `background:var(--s${(k % 6) + 1});opacity:.55` }), `張力 ${k + 1}–${k + 2}`));
    if (P.reelOn) lg.append(h('span', null, h('span', { class: 'swatch', style: 'background:var(--brass)' }), '張力 入側／出側（リール）'));
    bindSpgChips();
  }

  const scopeBufs = {};
  function seriesWindow(chan, i, n) {
    const key = chan + i;
    let out = scopeBufs[key];
    if (!out || out.length !== n) out = scopeBufs[key] = new Float32Array(n);
    return S.sim.window(S.sim.chan[chan][i], n, out);
  }
  function drawScope(c, rows, opts) {
    const { ctx, w, h: H } = fitCanvas(c);
    ctx.clearRect(0, 0, w, H);
    const left = 46, right = 10, top = 8, bottom = 20;
    const n = rows.length;
    let ymax = opts.ymin || 1;
    for (const r of rows) for (let j = 0; j < r.data.length; j++) { const a = Math.abs(r.data[j]); if (a > ymax) ymax = a; }
    ymax = niceCeil(ymax * 1.05);
    const cols = w - left - right;
    ctx.font = `11px ${TH.mono}`;
    const trace = (d, color, mid, amp, lw) => {
      const L = d.length;
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      let prevLast = d[0];
      for (let px = 0; px < cols; px++) {
        const a = Math.floor(px * L / cols), b = Math.max(a + 1, Math.floor((px + 1) * L / cols));
        let mn = prevLast, mx = prevLast;
        for (let j = a; j < b && j < L; j++) { const v = d[j]; if (v < mn) mn = v; if (v > mx) mx = v; }
        prevLast = d[Math.min(b, L) - 1];
        const y1 = mid - clamp(mx / ymax, -1.05, 1.05) * amp, y2 = mid - clamp(mn / ymax, -1.05, 1.05) * amp;
        ctx.moveTo(left + px + 0.5, y1); ctx.lineTo(left + px + 0.5, Math.max(y2, y1 + 0.8));
      }
      ctx.stroke();
    };
    if (opts.overlay) {
      const mid = top + (H - top - bottom) / 2, amp = (H - top - bottom) / 2 - 3;
      ctx.strokeStyle = TH.line2; ctx.lineWidth = 1;
      for (const fr of [-1, -0.5, 0, 0.5, 1]) { const yy = Math.round(mid - fr * amp) + 0.5; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(w - right, yy); ctx.stroke(); }
      ctx.fillStyle = TH.ink3; ctx.textAlign = 'right';
      for (const fr of [-1, -0.5, 0.5, 1]) ctx.fillText((fr * ymax).toString(), left - 4, mid - fr * amp + 4);
      ctx.fillText('0', left - 4, mid + 4);
      if (opts.guide && opts.guide < ymax) {
        ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = TH.warn; ctx.globalAlpha = 0.8;
        for (const s of [-1, 1]) { const yy = Math.round(mid - s * opts.guide / ymax * amp) + 0.5; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(w - right, yy); ctx.stroke(); }
        ctx.restore();
      }
      for (let i = 0; i < n; i++) trace(rows[i].data, rows[i].color, mid, amp, 1.2);
      // labels with live values (top-left, wrapped into columns when there are many rows)
      ctx.font = `700 11px ${TH.cond}`; ctx.textAlign = 'left';
      const perCol = Math.max(1, Math.floor((H - top - bottom) / 2 / 13)), colW = 96;
      for (let i = 0; i < n; i++) {
        const col = Math.floor(i / perCol), rowi = i % perCol;
        const lx = left + 6 + col * colW, ly = top + 12 + 13 * rowi;
        const last = rows[i].data[rows[i].data.length - 1];
        ctx.fillStyle = rows[i].color; ctx.fillText(rows[i].label, lx, ly);
        ctx.fillStyle = TH.ink2; ctx.font = `10.5px ${TH.mono}`; ctx.fillText((last >= 0 ? '+' : '') + last.toFixed(opts.dec == null ? 1 : opts.dec), lx + 40, ly); ctx.font = `700 11px ${TH.cond}`;
      }
      ctx.fillStyle = TH.ink3; ctx.font = `11px ${TH.mono}`; ctx.textAlign = 'center';
      for (let k = 0; k <= 4; k++) { const x = left + cols * k / 4; ctx.fillText(k === 4 ? 'now' : `−${(opts.secs * (1 - k / 4)).toFixed(2)} s`, x, H - 5); }
      ctx.textAlign = 'left'; ctx.fillText(opts.unit, left - 44, top + 8);
      return ymax;
    }
    const rowH = (H - top - bottom) / n;
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      const y0 = top + i * rowH, mid = y0 + rowH / 2, amp = rowH / 2 - 3;
      ctx.strokeStyle = TH.line2; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, Math.round(mid) + 0.5); ctx.lineTo(w - right, Math.round(mid) + 0.5); ctx.stroke();
      if (i > 0) { ctx.beginPath(); ctx.moveTo(left, Math.round(y0) + 0.5); ctx.lineTo(w - right, Math.round(y0) + 0.5); ctx.stroke(); }
      if (opts.guide && opts.guide < ymax) {
        ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = TH.warn; ctx.globalAlpha = 0.8;
        for (const s of [-1, 1]) { const yy = Math.round(mid - s * opts.guide / ymax * amp) + 0.5; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(w - right, yy); ctx.stroke(); }
        ctx.restore();
      }
      ctx.fillStyle = r.color; ctx.textAlign = 'left'; ctx.font = `700 12px ${TH.cond}`;
      ctx.fillText(r.label, 6, mid + 4);
      // trace (min/max per column)
      const d = r.data, L = d.length;
      trace(d, r.color, mid, amp, 1.2);
      // live value
      const last = d[L - 1];
      ctx.fillStyle = TH.ink2; ctx.font = `11px ${TH.mono}`; ctx.textAlign = 'right';
      ctx.fillText((last >= 0 ? '+' : '') + last.toFixed(opts.dec == null ? 1 : opts.dec), w - right - 2, y0 + 12);
    }
    // axes text
    ctx.fillStyle = TH.ink3; ctx.font = `11px ${TH.mono}`; ctx.textAlign = 'left';
    ctx.fillText(`±${ymax} ${opts.unit}`, left + 4, top + 11);
    ctx.textAlign = 'center';
    const secs = opts.secs;
    for (let k = 0; k <= 4; k++) {
      const x = left + cols * k / 4;
      ctx.fillText(k === 4 ? 'now' : `−${(secs * (1 - k / 4)).toFixed(2)} s`, x, H - 5);
    }
    return ymax;
  }
  let specCache = null;
  function drawSpectrum(c, specs, chans, unit) {
    const { ctx, w, h: H } = fitCanvas(c);
    ctx.clearRect(0, 0, w, H);
    const left = 46, right = 12, top = 22, bottom = 22;
    const fmax = specFmax();
    const xOf = f => left + f / fmax * (w - left - right);
    const thresh = S.specScale === 'thresh' && SPG.src === 'gauge';
    let ymax = 0.5;
    if (thresh) ymax = S.sim.breakAmp;
    else {
      for (const s of specs) for (let i = 1; i < s.mag.length; i++) if (s.mag[i] > ymax) ymax = s.mag[i];
      ymax = niceCeil(ymax * 1.05);
    }
    const yOf = v => H - bottom - clamp(v / ymax, 0, 1) * (H - top - bottom);
    for (const b of BANDS) {
      if (b.lo >= fmax) continue;
      const hi = Math.min(b.hi, fmax);
      ctx.fillStyle = TH.panel3; ctx.fillRect(xOf(b.lo), top - 4, xOf(hi) - xOf(b.lo), H - top - bottom + 4);
      ctx.fillStyle = TH.ink3; ctx.font = `600 10.5px ${TH.cond}`; ctx.textAlign = 'center';
      ctx.fillText(b.label.toUpperCase(), 0.5 * (xOf(b.lo) + xOf(hi)), top - 8);
    }
    if (thresh) {
      // break threshold at the top edge, coil-break guide
      ctx.save();
      ctx.strokeStyle = TH.crit; ctx.lineWidth = 1.2; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(left, Math.round(yOf(ymax)) + 0.5); ctx.lineTo(w - right, Math.round(yOf(ymax)) + 0.5); ctx.stroke();
      ctx.fillStyle = TH.critInk; ctx.font = `10.5px ${TH.mono}`; ctx.textAlign = 'right';
      ctx.fillText(`破断しきい値 ${ymax} µm`, w - right - 2, yOf(ymax) + 11);
      const cg = S.coilGuide;
      if (cg < ymax) {
        ctx.strokeStyle = TH.warn; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(left, Math.round(yOf(cg)) + 0.5); ctx.lineTo(w - right, Math.round(yOf(cg)) + 0.5); ctx.stroke();
        ctx.fillStyle = TH.warnInk; ctx.fillText(`${cg} µm コイル破断目安`, w - right - 2, yOf(cg) - 3);
      }
      ctx.restore();
    }
    ctx.strokeStyle = TH.line2; ctx.lineWidth = 1; ctx.fillStyle = TH.ink3; ctx.font = `11px ${TH.mono}`;
    for (let f = 0; f <= fmax; f += (fmax >= 800 ? 100 : 25)) {
      const x = Math.round(xOf(f)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, H - bottom); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(String(f), x, H - 6);
    }
    for (let k = 0; k <= 4; k++) {
      const y = Math.round(top + (H - top - bottom) * k / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(thresh ? String(Math.round(ymax * (1 - k / 4))) : (ymax * (1 - k / 4)).toPrecision(2), left - 4, y + 4);
    }
    ctx.textAlign = 'left'; ctx.fillText(unit, left - 40, top + 2);
    specs.forEach((s, i) => {
      ctx.strokeStyle = chans[i] ? chans[i].color : TH.series[i % 6]; ctx.lineWidth = 1.4; ctx.beginPath();
      const n = s.mag.length;
      for (let k = 0; k < n; k++) {
        const x = xOf(s.f[k]), y = H - bottom - clamp(s.mag[k] / ymax, 0, 1) * (H - top - bottom);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    specCache = { specs, xOf, left, right, w, H, ymax, chans, unit, fmax };
  }
  (function bindSpecHover() {
    const c = $('#spectrum'), tip = $('#tipSpec');
    c.addEventListener('mousemove', e => {
      if (!specCache) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const f = (x - specCache.left) / (specCache.w - specCache.left - specCache.right) * specCache.fmax;
      if (f < 0 || f > specCache.fmax) { tip.hidden = true; return; }
      const rows = specCache.specs.map((s, i) => {
        const k = clamp(Math.round(f / s.df), 0, s.mag.length - 1);
        const ch = specCache.chans[i] || { color: TH.ink2, label: `No.${i + 1}` };
        return `<span style="color:${ch.color}">■</span> ${ch.label} ${s.mag[k].toFixed(2)} ${specCache.unit}`;
      });
      showTip(tip, c, x, y, `${f.toFixed(0)} Hz<br>${rows.join('<br>')}`);
    });
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
  })();

  // ---- spectrogram (waterfall): one panel per stand, side by side ----------
  /** waterfall depth (s) → drawn rows N and FFT frames per row B (peak hold); ~50 rows so long depths stay light to draw */
  const WF_DEPTHS = [1.2, 5, 10, 20];
  function wfRows() {
    const B = Math.max(1, Math.round(SPG.depth / SPG.hop / 50));
    return { B, N: Math.max(2, Math.round(SPG.depth / (B * SPG.hop))) };
  }
  try { const d0 = parseFloat(localStorage.getItem('chatterlab.wfDepth')); if (WF_DEPTHS.includes(d0)) SPG.depth = d0; } catch (e) { /* ignore */ }
  function spgClear() { SPG.panels = []; SPG.sig = ''; SPG.vmax = 0.1; SPG.ver++; }
  /** panel definitions for the current source: one per stand (tension: per span incl. reel spans; vibration: top / bottom / larger WR) */
  function spgPanels() {
    if (!S.line) return [];
    const chans = spgChannels();
    if (SPG.src !== 'vib') return chans.map(c => ({ key: SPG.src + c.i, label: c.label.replace(/^NO\./, 'No.'), color: c.color, chans: [c] }));
    const out = [];
    for (let i = 0; i < S.line.nS; i++) {
      const top = chans.find(c => c.i === 2 * i), bot = chans.find(c => c.i === 2 * i + 1);
      out.push({ key: 'vib' + i, label: `No.${i + 1}`, color: TH.series[i % 6], chans: SPG.side === 'top' ? [top] : SPG.side === 'bottom' ? [bot] : [top, bot] });
    }
    return out;
  }
  const spgSig = defs => SPG.src + '|' + SPG.side + '|' + defs.map(d => d.key).join(',');
  function bindSpgChips() {
    const box = $('#spgChips');
    box.textContent = '';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'スペクトログラムの信号' });
    for (const [k, v] of Object.entries(SPG_SRC)) seg.append(h('button', { type: 'button', class: SPG.src === k ? 'on' : '', disabled: k === 'tors' && !(S.line && S.line.tors), onclick: () => { SPG.src = k; spgClear(); bindSpgChips(); try { localStorage.setItem('chatterlab.spgSrc', k); } catch (e) { /* ignore */ } } }, v.label));
    box.append(seg);
    if (SPG.src === 'vib') {
      const side = h('div', { class: 'seg', role: 'group', 'aria-label': '振動のチャネル' });
      for (const [k, label] of [['auto', '大きい方'], ['top', '上 WR'], ['bottom', '下 WR']]) side.append(h('button', { type: 'button', class: SPG.side === k ? 'on' : '', onclick: () => { SPG.side = k; spgClear(); bindSpgChips(); } }, label));
      box.append(side);
    }
    const depth = h('div', { class: 'seg', role: 'group', 'aria-label': '奥行き（時間）' });
    for (const d of WF_DEPTHS) depth.append(h('button', { type: 'button', class: SPG.depth === d ? 'on' : '', title: `奥行き ${d} 秒`, onclick: () => { SPG.depth = d; spgClear(); bindSpgChips(); try { localStorage.setItem('chatterlab.wfDepth', String(d)); } catch (e) { /* ignore */ } } }, `${d} s`));
    box.append(h('span', { class: 'lbl wf-lbl' }, '奥行き'), depth);
    updateWfNote();
    syncWfDom();
  }
  function updateWfNote() {
    const src = SPG_SRC[SPG.src];
    const { B } = wfRows();
    $('#wfNote').textContent = (src.zfix ? `Z 上限 ${src.zfix} ${src.unit}（固定）` : (SPG.src === 'gauge' && S.specScale === 'thresh' ? 'Z 上限 = 破断しきい値' : 'Z 自動スケール')) +
      ` · 1 列 = ${fmt(B * SPG.hop * 1000, 0)} ms${B > 1 ? `（FFT ${B} 回の最大値）` : ''}`;
  }
  function spectrogramStep() {
    const sim = S.sim; if (!sim || !S.line) return;
    if (sim.t < SPG.lastT) { spgClear(); SPG.nextT = 0; }
    SPG.lastT = sim.t;
    if (sim.t < SPG.nextT) return;
    SPG.nextT = sim.t + SPG.hop;
    const m = Math.min(sim.count, SPG.win);
    if (m < 256) return;
    if (SPG.src === 'tors' && !S.line.tors) { SPG.src = 'gauge'; spgClear(); bindSpgChips(); }
    const defs = spgPanels();
    if (!defs.length) return;
    const sig = spgSig(defs);
    if (sig !== SPG.sig) { SPG.panels = defs.map(d => Object.assign(d, { frames: [], chOf: [], fill: 0 })); SPG.sig = sig; }
    const { B, N } = wfRows();
    let mx = 0;
    for (const p of SPG.panels) {
      let cc = p.chans[0];
      if (p.chans.length > 1) {
        // larger rms over the FFT window
        let bestV = -1;
        for (const c of p.chans) {
          const d = seriesWindow(c.chan, c.si, m);
          let ss = 0; for (let j = 0; j < d.length; j += 4) ss += d[j] * d[j];
          if (ss > bestV) { bestV = ss; cc = c; }
        }
      }
      const sp = M.spectrum(seriesWindow(cc.chan, cc.si, m), m, sim.fs, SPG.win, specFmax());
      if (p.frames.length && p.fill < B) {
        // same row: peak hold over the row's B FFT frames (a short chatter burst is not averaged away)
        const fr = p.frames[p.frames.length - 1];
        for (let k = 0; k < fr.length; k++) if (sp.mag[k] > fr[k]) fr[k] = sp.mag[k];
        p.fill++; p.chOf[p.chOf.length - 1] = cc;
      } else { p.frames.push(sp.mag); p.chOf.push(cc); p.fill = 1; }
      SPG.df = sp.df;
      while (p.frames.length > N) { p.frames.shift(); p.chOf.shift(); }
      for (const fr of p.frames) for (let k = 1; k < fr.length; k++) if (fr[k] > mx) mx = fr[k];
    }
    // common Z scale: fixed (vibration), break threshold (gauge), or auto with slow release
    const src = SPG_SRC[SPG.src];
    if (src.zfix) SPG.vmax = src.zfix;
    else if (SPG.src === 'gauge' && S.specScale === 'thresh') SPG.vmax = sim.breakAmp;
    else { const target = niceCeil(Math.max(mx, 0.02) * 1.1); SPG.vmax = target > SPG.vmax ? target : SPG.vmax + (target - SPG.vmax) * 0.25; }
    SPG.ver++;
  }
  /** (re)create one canvas per panel when the panel set changes */
  let wfDomSig = '';
  function syncWfDom() {
    const defs = spgPanels(), sig = spgSig(defs);
    if (sig === wfDomSig && $('#wfGrid').children.length === defs.length) return;
    wfDomSig = sig;
    const grid = $('#wfGrid');
    grid.textContent = '';
    defs.forEach((d, k) => {
      const zoomBtn = h('button', { class: 'wf-zbtn', type: 'button', title: 'このパネルを拡大', 'aria-label': `${d.label} を拡大`, onclick: () => setWfZoom(k) }, '⤢');
      grid.append(h('div', { class: 'wf-panel', 'data-k': k },
        h('div', { class: 'wf-head' }, h('span', { class: 'swatch', style: `background:${d.color}` }), h('b', null, d.label), h('span', { class: 'wf-peak' }, ''), zoomBtn),
        h('canvas', { class: 'chart wf-canvas' })));
    });
    if (SPG.zoom != null && SPG.zoom >= defs.length) SPG.zoom = -1;
    applyWfZoom();
    for (const c of $$('.wf-canvas', grid)) bindWfHover(c);
    wfDrawn = '';
  }
  /* zoom: null = inline, -1 = all panels enlarged, k = panel k alone */
  function setWfZoom(z) { SPG.zoom = z; applyWfZoom(); }
  function applyWfZoom() {
    const card = $('#wfCard'), z = SPG.zoom, n = $('#wfGrid').children.length;
    const on = z != null;
    card.classList.toggle('wf-max', on);
    document.documentElement.classList.toggle('wf-open', on);
    $$('.wf-panel', card).forEach((p, k) => { p.hidden = on && z >= 0 && k !== z; });
    const cols = !on ? n : z >= 0 ? 1 : (n <= 3 ? n : Math.ceil(n / 2));
    $('#wfGrid').style.setProperty('--wf-cols', Math.max(1, cols));
    $('#wfGrid').style.setProperty('--wf-rows', !on || z >= 0 ? 1 : Math.ceil(n / Math.max(1, cols)));
    const zb = $('#wfZoom');
    zb.textContent = on ? '閉じる（Esc）' : '拡大表示';
    zb.setAttribute('aria-pressed', String(on));
    $('#wfAll').hidden = !(on && z >= 0 && n > 1);
    $('#tipSpg').hidden = true;
    wfDrawn = '';
  }
  $('#wfZoom').addEventListener('click', () => setWfZoom(SPG.zoom == null ? -1 : null));
  $('#wfAll').addEventListener('click', () => setWfZoom(-1));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && SPG.zoom != null) setWfZoom(null); });

  /** nice tick step for a 0..vmax axis with about `n` intervals */
  function niceStep(vmax, n) {
    const raw = vmax / n, e = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
  }
  let wfDrawn = '';
  function drawWaterfalls() {
    const canv = $$('#wfGrid .wf-canvas');
    if (!canv.length) return;
    let sizes = '';
    for (const c of canv) { const r = c.getBoundingClientRect(); sizes += `${Math.round(r.width)}x${Math.round(r.height)},`; }
    const key = `${SPG.ver}|${sizes}|${SPG.vmax}|${TH.panel}`;
    if (key === wfDrawn) return;
    wfDrawn = key;
    const src = SPG_SRC[SPG.src];
    canv.forEach((c, k) => {
      if (c.closest('.wf-panel').hidden) return;
      const p = SPG.panels[k] && SPG.sig === wfDomSig ? SPG.panels[k] : null;
      drawWaterfallPanel(c, p, SPG.vmax, src);
      const pk = c.closest('.wf-panel').querySelector('.wf-peak');
      if (p && p.frames.length) {
        const fr = p.frames[p.frames.length - 1];
        let q = 1; for (let j = 1; j < fr.length; j++) if (fr[j] > fr[q]) q = j;
        const over = src.zfix && fr[q] > src.zfix;
        pk.textContent = `${(q * SPG.df).toFixed(0)} Hz · ${fr[q] < 10 ? fr[q].toFixed(2) : fr[q].toFixed(1)} ${src.unit}${over ? '（上限超え）' : ''}`;
        pk.classList.toggle('over', !!over);
      } else pk.textContent = '';
    });
  }
  function drawWaterfallPanel(c, p, vmax, src) {
    const { ctx, w, h: H } = fitCanvas(c);
    ctx.clearRect(0, 0, w, H);
    const { B, N } = wfRows(), rowT = B * SPG.hop, frames = p ? p.frames : [], n = frames.length;
    const narrow = w < 330;
    const left = narrow ? 38 : 46, right = 10, top = 16, bottom = 26;
    const areaW = w - left - right, areaH = H - top - bottom;
    const depthX = Math.min(0.3 * areaW, 150), depthY = areaH * 0.42;
    const ox = depthX / (N - 1), oy = depthY / (N - 1);
    const plotW = areaW - depthX, ampH = areaH - depthY;
    const y0 = H - bottom, yb = y0 - depthY, back = N - 1;
    const fmax = specFmax();
    const xOf = f => left + f / fmax * plotW;
    const fs = narrow ? 10 : 11;
    const step = niceStep(vmax, ampH < 70 ? 2 : ampH < 120 ? 4 : 5);
    const ticks = []; for (let v = 0; v <= vmax * 1.0001; v += step) ticks.push(v);
    const yv = v => v / vmax * ampH;
    // floor bands (parallelograms)
    for (const b of BANDS) {
      if (b.lo >= fmax) continue;
      const x1 = xOf(b.lo), x2 = xOf(Math.min(b.hi, fmax));
      ctx.fillStyle = TH.panel3;
      ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x2, y0); ctx.lineTo(x2 + depthX, yb); ctx.lineTo(x1 + depthX, yb); ctx.closePath(); ctx.fill();
      ctx.fillStyle = TH.ink3; ctx.font = `600 ${narrow ? 9 : 10}px ${TH.cond}`; ctx.textAlign = 'center';
      ctx.fillText(narrow ? b.label.split(' ')[0].toUpperCase() : b.label.toUpperCase(), 0.5 * (x1 + x2) + depthX, yb - 4);
    }
    // Z grid on the back wall and the left wall (hidden behind the frames)
    ctx.strokeStyle = TH.line; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const v of ticks) {
      if (v === 0) continue;
      ctx.moveTo(left, y0 - yv(v)); ctx.lineTo(left + depthX, yb - yv(v)); ctx.lineTo(left + plotW + depthX, yb - yv(v));
    }
    ctx.moveTo(left + depthX, yb); ctx.lineTo(left + depthX, yb - ampH);
    ctx.stroke();
    // floor edges
    ctx.beginPath();
    ctx.moveTo(left, y0); ctx.lineTo(left + plotW, y0);
    ctx.moveTo(left, y0); ctx.lineTo(left + depthX, yb);
    ctx.moveTo(left + plotW, y0); ctx.lineTo(left + plotW + depthX, yb);
    ctx.moveTo(left + depthX, yb); ctx.lineTo(left + plotW + depthX, yb);
    ctx.stroke();
    // frames: oldest (back) → newest (front)
    const topClamp = src.zfix ? 1.04 : 1.15;
    for (let j = 0; j < n; j++) {
      const age = n - 1 - j;
      const dx = age * ox, dy = -age * oy;
      const fr = frames[j], L = fr.length;
      ctx.beginPath();
      ctx.moveTo(left + dx, y0 + dy);
      for (let k = 0; k < L; k++) ctx.lineTo(left + dx + (k * SPG.df) / fmax * plotW, y0 + dy - clamp(fr[k] / vmax, 0, topClamp) * ampH);
      ctx.lineTo(left + dx + plotW, y0 + dy);
      ctx.closePath();
      ctx.fillStyle = TH.panel; ctx.fill();
      ctx.globalAlpha = 0.28 + 0.72 * (1 - age / N);
      ctx.strokeStyle = p.chOf[j] ? p.chOf[j].color : p.color; ctx.lineWidth = age === 0 ? 1.8 : 1.1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (!n) {
      ctx.fillStyle = TH.ink3; ctx.font = `12px ${TH.sans}`; ctx.textAlign = 'center';
      ctx.fillText('フレーム収集中…', left + plotW / 2, y0 - ampH / 2);
    }
    // Z axis on the front-left edge (drawn last so it stays readable)
    ctx.strokeStyle = TH.ink3; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y0); ctx.lineTo(left, y0 - ampH);
    for (const v of ticks) { ctx.moveTo(left - 4, y0 - yv(v)); ctx.lineTo(left, y0 - yv(v)); }
    ctx.stroke();
    ctx.fillStyle = TH.ink3; ctx.font = `${fs}px ${TH.mono}`; ctx.textAlign = 'right';
    const dec = step < 1 ? (step < 0.1 ? 2 : 1) : (step % 1 ? 1 : 0);
    for (const v of ticks) ctx.fillText(v.toFixed(dec), left - 6, y0 - yv(v) + 4);
    ctx.textAlign = 'left'; ctx.font = `600 ${fs}px ${TH.cond}`;
    ctx.fillText(`Z ${src.unit}`, 2, Math.max(fs, y0 - ampH - 10));
    // frequency and time labels
    ctx.font = `${fs}px ${TH.mono}`; ctx.textAlign = 'center';
    const fStep = fmax / (plotW < 170 ? 2 : 4);
    for (let f = 0; f <= fmax; f += fStep) ctx.fillText(String(f), xOf(f), y0 + 14);
    ctx.textAlign = 'right';
    ctx.fillText('Hz', left + plotW + depthX, y0 + 14);
    const tLbl = t => `−${t < 10 ? t.toFixed(1).replace(/\.0$/, '') : t.toFixed(0)} s`;
    ctx.fillText(tLbl(N * rowT), left + depthX - 5, yb + 4);
    ctx.fillText(tLbl(N * rowT / 2), left + depthX / 2 - 5, y0 - depthY / 2 + 4);
    c.__wf = { left, plotW, y0, ox, oy, n, fmax, p, rowT };
  }
  function bindWfHover(c) {
    const tip = $('#tipSpg');
    c.addEventListener('mousemove', e => {
      const g = c.__wf;
      if (!g || !g.n || !g.p) { tip.hidden = true; return; }
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      // nearest frame by vertical position on the floor, then frequency from x minus that frame's offset
      const age = clamp(Math.round((g.y0 - y) / g.oy), 0, g.n - 1);
      const j = g.n - 1 - age;
      const f = (x - g.left - age * g.ox) / g.plotW * g.fmax;
      const fr = g.p.frames[j];
      if (!fr || f < 0 || f > g.fmax) { tip.hidden = true; return; }
      const k = clamp(Math.round(f / SPG.df), 0, fr.length - 1);
      let pk = 1; for (let q = 1; q < fr.length; q++) if (fr[q] > fr[pk]) pk = q;
      const ch = g.p.chOf[j], unit = SPG_SRC[SPG.src].unit;
      showTip(tip, c, x, y, `${g.rowT > 0.05 ? `${(-(age + 1) * g.rowT).toFixed(1)}〜${(-age * g.rowT).toFixed(1)} s（最大値）` : `${(-age * g.rowT).toFixed(2)} s`} · ${SPG_SRC[SPG.src].label} ${ch ? ch.label : g.p.label}<br>${f.toFixed(0)} Hz: ${fr[k].toFixed(2)} ${unit}<br>peak ${(pk * SPG.df).toFixed(0)} Hz: ${fr[pk].toFixed(2)} ${unit}`);
    });
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  let liveTick = 0;
  const lastSpecs = [];
  function drawLive() {
    const sim = S.sim, line = S.line;
    const n = Math.min(sim.count, Math.round(S.scopeWin * sim.fs));
    if (n < 4) return;
    const rowsG = [], rowsT = [], rowsF = [];
    for (let i = 0; i < line.nS; i++) rowsG.push({ data: seriesWindow('gauge', i, n), color: TH.series[i], label: `No.${i + 1}` });
    for (let k = 0; k < line.nS - 1; k++) rowsT.push({ data: seriesWindow('tension', k, n), color: TH.series[k % 6], label: `${k + 1}–${k + 2}` });
    if (line.reel) {
      rowsT.push({ data: seriesWindow('tension', line.nS - 1, n), color: TH.brass, label: '入側' });
      rowsT.push({ data: seriesWindow('tension', line.nS, n), color: TH.brass, label: '出側' });
    }
    for (let i = 0; i < line.nS; i++) rowsF.push({ data: seriesWindow('force', i, n), color: TH.series[i], label: `No.${i + 1}` });
    const ymaxG = drawScope($('#scopeGauge'), rowsG, { unit: 'µm', ymin: 1, guide: S.coilGuide, secs: n / sim.fs, dec: 1, overlay: S.gaugeOverlay });
    $('#gaugeScale').textContent = `板厚 ±${ymaxG} µm · 破線 ±${S.coilGuide} µm（コイル破断の目安）`;
    drawScope($('#scopeTension'), rowsT, { unit: 'MPa', ymin: 1, secs: n / sim.fs, dec: 1, overlay: S.gaugeOverlay });
    drawScope($('#scopeForce'), rowsF, { unit: 'kN', ymin: 10, secs: n / sim.fs, dec: 0, overlay: S.gaugeOverlay });
    {
      const vibChans = (() => { const keep = SPG.src; SPG.src = 'vib'; const c = spgChannels(); SPG.src = keep; return c; })();
      const rowsV = vibChans.map(c => ({ data: seriesWindow(c.chan, c.si, n), color: c.color, label: c.label }));
      drawScope($('#scopeVib'), rowsV, { unit: 'm/s²', ymin: 0.5, secs: n / sim.fs, dec: 2, overlay: true });
    }
    {
      const tqCard = $('#scopeTq').closest('.card');
      tqCard.hidden = !line.tors;
      if (line.tors) {
        const rowsQ = [];
        for (let i = 0; i < line.nS; i++) rowsQ.push({ data: seriesWindow('tq', i, n), color: TH.series[i % 6], label: `SP${i + 1}` });
        drawScope($('#scopeTq'), rowsQ, { unit: 'kN·m', ymin: 0.5, secs: n / sim.fs, dec: 2, overlay: true });
      }
    }
    const wrxCard = $('#scopeWrx').closest('.card');
    wrxCard.hidden = !line.stands[0].nx;
    if (line.stands[0].nx) {
      const rowsX = [];
      for (let i = 0; i < line.nS; i++) rowsX.push({ data: seriesWindow('wrx', i, n), color: TH.series[i], label: `No.${i + 1}` });
      drawScope($('#scopeWrx'), rowsX, { unit: 'µm', ymin: 1, secs: n / sim.fs, dec: 2 });
    }
    // spectrum every 3rd frame (signal follows the spectrogram source)
    const src = SPG_SRC[SPG.src], chans = spgChannels();
    if (liveTick++ % 3 === 0 || !lastSpecs.length) {
      const N = 8192;
      const m = Math.min(sim.count, N);
      lastSpecs.length = 0;
      for (const c of chans) lastSpecs.push(M.spectrum(seriesWindow(c.chan, c.si, m), m, sim.fs, N, specFmax()));
      updateReadouts(rowsG, n);
    }
    $('#specTitle').textContent = `${src.label === '板厚' ? '板厚偏差' : src.label === '張力' ? 'スタンド間張力偏差' : src.label === '荷重' ? '圧延荷重偏差' : src.label === 'ねじり' ? 'スピンドルトルク偏差' : 'ロール振動加速度'}スペクトル`;
    drawSpectrum($('#spectrum'), lastSpecs, chans, src.unit);
    drawWaterfalls();
  }
  function updateReadouts(rowsG, n) {
    const sim = S.sim;
    // dominant stand = largest rms
    let best = 0, bestRms = -1;
    const rms = [];
    for (let i = 0; i < rowsG.length; i++) {
      const d = rowsG[i].data; let ss = 0; for (let j = 0; j < d.length; j++) ss += d[j] * d[j];
      const r = Math.sqrt(ss / d.length); rms.push(r);
      if (r > bestRms) { bestRms = r; best = i; }
    }
    const mBest = Math.min(sim.count, 8192);
    const sp = M.spectrum(seriesWindow('gauge', best, mBest), mBest, sim.fs, 8192, 800);
    const gwin = Math.min(sim.count, Math.round(0.4 * sim.fs));
    const gd = seriesWindow('gauge', best, gwin);
    const sinceBreak = sim.t - sim.lastBreakT;
    const gr = sinceBreak > 0.45 ? M.growthRate(gd, gwin, sim.fs, 0, gwin / sim.fs) : { ok: false, sigma: 0 };
    let maxAbs = 0; for (const r of rowsG) for (let j = 0; j < r.data.length; j++) { const a = Math.abs(r.data[j]); if (a > maxAbs) maxAbs = a; }
    let tmin = Infinity;
    for (let k = 0; k < S.line.nS - 1; k++) tmin = Math.min(tmin, P.sigma[k + 1] + sim.y[S.line.T + k]);
    if (S.line.reel) tmin = Math.min(tmin, P.sigma[0] + sim.y[S.line.Rr], P.sigma[S.line.nS] + sim.y[S.line.Rr + 3]);
    const zeq = gr.ok && sp.peakF > 1 ? -gr.sigma / (TWO_PI * sp.peakF) : null;
    const box = $('#readouts');
    const ro = (k, v, u, cls) => h('div', { class: 'readout ' + (cls || '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, u ? h('span', { class: 'u' }, u) : null));
    const growCls = !gr.ok ? '' : gr.sigma > 1 ? 'crit' : gr.sigma > -1 ? 'warn' : 'good';
    box.textContent = '';
    box.append(
      ro('卓越周波数（No.' + (best + 1) + '）', sp ? fmtI(sp.peakF) : '—', 'Hz'),
      ro('成長率 σ（包絡線）', gr.ok ? (gr.sigma >= 0 ? '+' : '') + fmt(gr.sigma, 1) : '—', '/s', growCls),
      ro('等価減衰比', zeq == null ? '—' : fmt(zeq * 100, 2), '%', growCls),
      ro('最大板厚偏差（表示窓）', fmt(maxAbs, 1), 'µm', maxAbs > S.coilGuide ? 'crit' : maxAbs > S.coilGuide / 3 ? 'warn' : ''),
      ro('最小張力', fmt(tmin, 0), 'MPa', tmin < 20 ? 'crit' : ''),
      ro('破断回数', String(sim.breaks), '', sim.breaks ? 'crit' : ''),
      ro('シミュレーション時刻', fmt(sim.t, 2), 's'),
    );
    const hb = $('#heroBreaks'); if (hb) hb.textContent = String(sim.breaks);
  }
  function updateCardRms() {
    const sim = S.sim; if (!sim || sim.count < 10) return;
    const n = Math.min(sim.count, Math.round(0.2 * sim.fs));
    let best = 0, bestV = -1;
    $$('#standCards .live').forEach(el => {
      const i = +el.dataset.i;
      const d = seriesWindow('gauge', i, n);
      let ss = 0; for (let j = 0; j < d.length; j++) ss += d[j] * d[j];
      const r = Math.sqrt(ss / d.length);
      if (r > bestV) { bestV = r; best = i; }
      el.textContent = r.toFixed(2) + ' µm';
    });
    S.bestStand = best;
  }
  let toastTimer = null;
  function onBreak() {
    let t = $('#toast');
    if (!t) { t = h('div', { class: 'toast', id: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = `板厚偏差が ${S.sim.breakAmp} µm を超過 → 板破断。再通板して継続（${S.sim.breaks} 回目）`;
    t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
    const hb = $('#heroBreaks'); if (hb) hb.textContent = String(S.sim.breaks);
  }

  /* ================================================================
   * stability map
   * ================================================================ */
  const AXES = {
    zeta: { label: '要素減衰比 ζ', min: 0.02, max: 0.25, fmt: v => v.toFixed(3), cur: () => P.zeta, apply: (q, v) => { q.zeta = v; } },
    mu: { label: '摩擦係数倍率', min: 0.5, max: 2.0, fmt: v => '×' + v.toFixed(2), cur: () => 1, apply: (q, v) => { q.mu = P.mu.map(m => m * v); } },
    tension: { label: '張力倍率', min: 0.4, max: 1.8, fmt: v => '×' + v.toFixed(2), cur: () => 1, apply: (q, v) => { q.sigma = P.sigma.map(s => s * v); } },
    Lgap: { label: 'スタンド間距離 mm', min: 2000, max: 9000, fmt: v => v.toFixed(0), cur: () => P.Lgap, apply: (q, v) => { q.Lgap = v; } },
    kHouse: { label: 'ハウジング剛性 GN/m', min: 3, max: 40, fmt: v => v.toFixed(1), cur: () => P.kHouse, apply: (q, v) => { q.kHouse = v; } },
    width: { label: '板幅 mm', min: 600, max: 1800, fmt: v => v.toFixed(0), cur: () => P.width, apply: (q, v) => { q.width = v; } },
  };
  const fmtSafe = f => v => (v == null || !isFinite(v)) ? '—' : f(v);
  for (const ax of Object.values(AXES)) ax.fmt = fmtSafe(ax.fmt);
  const VMIN = 100, VMAX = 2500;
  /** axis definition for a key: base axes or per-stand friction ('mu:i') / per-span tension ('sig:k') */
  function axisFor(key) {
    if (AXES[key]) return AXES[key];
    if (key.startsWith('mu:')) {
      const i = +key.slice(3);
      return { label: `摩擦係数 No.${i + 1}`, min: 0.01, max: 0.08, fmt: fmtSafe(v => v.toFixed(3)), cur: () => P.mu[i], apply: (q, v) => { q.mu = P.mu.slice(); q.mu[i] = v; } };
    }
    if (key.startsWith('red:')) {
      const i = +key.slice(4), n = nS();
      const hin = i ? P.h[i - 1] : P.h0;
      const rmax = i < n - 1 ? Math.min(0.5, 1 - 1.02 * P.h[i + 1] / hin) : 0.5;
      const min = 0.03, max = Math.max(min + 0.02, rmax);
      return { label: `圧下率 No.${i + 1}`, min, max, fmt: fmtSafe(v => `${(v * 100).toFixed(1)} %`), cur: () => 1 - P.h[i] / hin, apply: (q, v) => { q.h = P.h.slice(); q.h[i] = hin * (1 - v); } };
    }
    if (key.startsWith('sig:')) {
      const k = +key.slice(4), n = nS();
      const name = k === 0 ? '入側' : k === n ? '出側' : `${k}–${k + 1}`;
      return { label: `張力 ${name}`, min: 10, max: 300, fmt: fmtSafe(v => `${v.toFixed(0)} MPa`), cur: () => P.sigma[k], apply: (q, v) => { q.sigma = P.sigma.slice(); q.sigma[k] = v; } };
    }
    return AXES.zeta;
  }
  /* ---- No.s × No.s+1 reduction-pair map: fixed speed, final exit thickness held ---- */
  // Pure functions (no closure references): they are also injected into the worker source.
  function pairParams(base, key, x, y, vFixed) {
    var s = +key.split(':')[1];
    var hin = s ? base.h[s - 1] : base.h0;
    var hA = hin * (1 - x);
    var hB = key.indexOf('r34line:') === 0 ? hin * y : hA * (1 - y);
    var h = base.h.slice(); h[s] = hA; h[s + 1] = hB;
    return Object.assign({}, base, { vExit: vFixed, h: h });
  }
  /** most unstable oscillatory mode of one family (all | vert | horiz | tors), or null when the line has no such mode.
      Families follow the map colouring: vertical = third / fifth / housing kinds, horizontal = kind 2, torsion = kind 6. */
  function pickCritical(r, family) {
    if (!family || family === 'all' || !isFinite(r.maxRe)) return r.critical;   // failed analysis: same 'not computable' cell as 全モード
    var want = family === 'vert' ? [0, 1, 3] : family === 'horiz' ? [2] : family === 'tors' ? [6] : null;
    if (!want) return r.critical;
    for (var i = 0; i < r.modes.length; i++) {
      var m = r.modes[i];
      if (m.f >= 5 && want.indexOf(m.kind) >= 0) return m;
    }
    return null;
  }
  function feasibleSchedule(q) {
    var prev = q.h0;
    for (var i = 0; i < q.h.length; i++) {
      if (!(q.h[i] > 0) || q.h[i] > prev * 0.995 || q.h[i] < prev * 0.3) return false;
      prev = q.h[i];
    }
    return true;
  }
  const mapCanvas = new Map();   // axis key → canvas (multi-map modes)
  let mapTimer = null;
  let mapJobId = 0;
  // ---- background worker (falls back to in-frame computation when unavailable)
  let worker = null;
  try {
    const modelSrc = document.getElementById('modelSrc').textContent;
    const src = `
importScripts('https://cdn.jsdelivr.net/npm/ml-matrix@6.11.1/matrix.umd.js');
${modelSrc}
const M = self.ChatterModel;
${pairParams.toString()}
${feasibleSchedule.toString()}
${pickCritical.toString()}
function applyAxis(q, key, v, base) {
  if (key.startsWith('mu:')) { const i = +key.slice(3); q.mu = base.mu.slice(); q.mu[i] = v; return; }
  if (key.startsWith('sig:')) { const k = +key.slice(4); q.sigma = base.sigma.slice(); q.sigma[k] = v; return; }
  if (key.startsWith('red:')) { const i = +key.slice(4); const hin = i ? base.h[i - 1] : base.h0; q.h = base.h.slice(); q.h[i] = hin * (1 - v); return; }
  if (key === 'zeta') q.zeta = v;
  else if (key === 'mu') q.mu = base.mu.map(m => m * v);
  else if (key === 'tension') q.sigma = base.sigma.map(s => s * v);
  else if (key === 'Lgap') q.Lgap = v;
  else if (key === 'kHouse') q.kHouse = v;
  else if (key === 'width') q.width = v;
}
let jobs = [], row = 0, running = false, paused = false;
function tick() {
  if (paused) { running = false; return; }
  if (!jobs.length) { running = false; return; }
  running = true;
  const job = jobs[0];
  if (row >= job.ys.length) { jobs.shift(); row = 0; setTimeout(tick, 0); return; }
  const n = job.xs.length;
  const re = new Float32Array(n), f = new Float32Array(n), dom = new Int8Array(n), kind = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    let q;
    if (job.axisKey.indexOf('r34') === 0) {
      q = pairParams(job.base, job.axisKey, job.xs[i], job.ys[row], job.vFixed);
      if (!feasibleSchedule(q)) { re[i] = NaN; kind[i] = 5; continue; }
    } else {
      q = Object.assign({}, job.base, { vExit: job.xs[i] });
      applyAxis(q, job.axisKey, job.ys[row], job.base);
    }
    try { const c = pickCritical(M.eigenAnalysis(new M.Line(q), { fmin: 5 }), job.family); if (c) { re[i] = c.re; f[i] = c.f; dom[i] = c.domStand; kind[i] = c.kind; } else { re[i] = NaN; kind[i] = -1; } }
    catch (err) { re[i] = NaN; kind[i] = 5; }
  }
  self.postMessage({ jobId: job.jobId, j: row, re, f, dom, kind });
  row++;
  setTimeout(tick, 0);
}
self.onmessage = e => {
  if (e.data.cancel) { jobs = []; row = 0; return; }
  if ('pause' in e.data) { paused = !!e.data.pause; if (!paused && !running && jobs.length) setTimeout(tick, 0); return; }
  jobs.push(e.data);
  if (!running && !paused) setTimeout(tick, 0);
};
self.postMessage({ ready: true });
`;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onerror = () => { worker = null; if (S.map && S.map.done < S.map.nx * S.map.ny) startMap(); };
    worker.onmessage = e => {
      const d = e.data;
      if (d.ready) { worker.ready = true; return; }
      const g = allGrids().find(q => q.jobId === d.jobId);
      if (!g) return;
      g.re.set(d.re, d.j * g.nx); g.f.set(d.f, d.j * g.nx); g.dom.set(d.dom, d.j * g.nx); g.kind.set(d.kind, d.j * g.nx);
      g.done = (d.j + 1) * g.nx;
      updateMapProgress();
      markMapDirty(g);
      if (allGrids().every(q => q.done >= q.nx * q.ny)) renderCritTable();
    };
  } catch (e) { worker = null; }
  function scheduleMap() {
    clearTimeout(mapTimer);
    mapTimer = setTimeout(startMap, 250);
  }
  function allGrids() { return S.mapMode !== 'single' ? (S.maps || []) : (S.map ? [S.map] : []); }
  function updateMapProgress() {
    const gs = allGrids(); if (!gs.length) return;
    const done = gs.reduce((a, g) => a + g.done, 0), total = gs.reduce((a, g) => a + g.nx * g.ny, 0);
    $('#mapProgress').textContent = done < total ? `${S.halted ? '停止中' : '計算中'} ${Math.round(100 * done / total)} %` : '';
  }
  function makeGrid(axisKey, nx, ny) {
    const ax = axisFor(axisKey);
    const grid = { nx, ny, re: new Float32Array(nx * ny), f: new Float32Array(nx * ny), dom: new Int8Array(nx * ny), kind: new Int8Array(nx * ny), xs: [], ys: [], axisKey, ax, done: 0, jobId: ++mapJobId };
    for (let i = 0; i < nx; i++) grid.xs.push(VMIN + (VMAX - VMIN) * i / (nx - 1));
    for (let j = 0; j < ny; j++) grid.ys.push(ax.min + (ax.max - ax.min) * j / (ny - 1));
    // closed-form estimate (negative-damping balance) along the y axis — cheap, computed up front
    const base = Object.assign({}, P, { h: P.h.slice(), mu: P.mu.slice(), sigma: P.sigma.slice(), standTypes: P.standTypes.slice(), vExit: 1000 });
    grid.approx = grid.ys.map(v => {
      const q = Object.assign({}, base); ax.apply(q, v);
      try { return M.approxCritical(new M.Line(q)).v; } catch (e) { return NaN; }
    });
    return grid;
  }
  /** No.3×No.4 maps are computed at the current speed plus each of these offsets (1,200 / 1,400 / 1,600 m/min at the default 1,000) */
  const PAIR_DV = [200, 400, 600];
  /** No.(s+1) × No.(s+2) reduction map at v + dv m/min; the coupling line keeps No.(s+2)'s exit thickness */
  function makePairGrid(s, np, dv) {
    const n = nS();
    const hin = s ? P.h[s - 1] : P.h0;
    const k = P.h[s + 1] / hin;                               // (1 − r3)(1 − r4) on the coupling line
    const rmin = 0.03, rmax = clamp(1 - k + 0.03, 0.3, 0.65);
    const r3cur = 1 - P.h[s] / hin, r4cur = 1 - P.h[s + 1] / P.h[s];
    const pct = fmtSafe(v => `${(v * 100).toFixed(0)} %`);
    const vFixed = P.vExit + dv;
    const grid = {
      nx: np, ny: np, re: new Float32Array(np * np), f: new Float32Array(np * np), dom: new Int8Array(np * np), kind: new Int8Array(np * np),
      xs: [], ys: [], axisKey: `r34:${s}:${dv}`, done: 0, jobId: ++mapJobId, special: 'pair', approx: null,
      ax: { label: `圧下率 No.${s + 2}`, min: rmin, max: rmax, fmt: pct, cur: () => r4cur },
      xAx: { label: `圧下率 No.${s + 1}`, min: rmin, max: rmax, fmt: pct },
      xMin: rmin, xMax: rmax, s, k, hin, hNext: s + 2 < n ? P.h[s + 2] : null, hExit: P.h[n - 1], lastStand: s + 1 === n - 1,
      r3cur, r4cur, vFixed, dv,
    };
    for (let i = 0; i < np; i++) { const r = rmin + (rmax - rmin) * i / (np - 1); grid.xs.push(r); grid.ys.push(r); }
    try {
      const c = pickCritical(M.eigenAnalysis(new M.Line(Object.assign({}, P, { vExit: vFixed })), { fmin: 5 }), S.mapFamily);
      grid.cur = c ? { re: c.re, f: c.f, dom: c.domStand } : null;
    } catch (e) { grid.cur = null; }
    const lo = Math.max(rmin, 1 - k / (1 - rmax)), hi = Math.min(rmax, 1 - k / (1 - rmin));
    const xsL = [];
    if (hi > lo) {
      for (let i = 0; i < 40; i++) xsL.push(lo + (hi - lo) * i / 39);
      if (r3cur > lo && r3cur < hi) xsL.push(r3cur);
      xsL.sort((a, b) => a - b);
    }
    const nL = xsL.length;
    grid.line = { nx: nL, ny: 1, re: new Float32Array(nL), f: new Float32Array(nL), dom: new Int8Array(nL), kind: new Int8Array(nL),
      xs: xsL, ys: [k], axisKey: `r34line:${s}:${dv}`, done: 0, jobId: ++mapJobId, special: 'pairLine', vFixed };
    return grid;
  }
  function startMap() {
    const res = parseInt($('#mapRes').value, 10);
    const base = Object.assign({}, P, { h: P.h.slice(), mu: P.mu.slice(), sigma: P.sigma.slice(), standTypes: P.standTypes.slice() });
    if (worker) worker.postMessage({ cancel: true });
    S.mapJob = null; S.mapQueue = [];
    if (S.mapMode === 'all') {
      const nx = Math.max(12, Math.round(res * 0.7)), ny = Math.max(8, Math.round(res * 0.5));
      const keys = Object.keys(AXES);
      buildMapCells([{ title: null, keys }]);
      S.maps = keys.map(k => makeGrid(k, nx, ny));
      S.map = null;
    } else if (S.mapMode === 'stand') {
      const n = nS();
      const nx = Math.max(10, Math.round(res * 0.55)), ny = Math.max(8, Math.round(res * 0.4));
      const muKeys = Array.from({ length: n }, (_, i) => `mu:${i}`);
      const sigKeys = Array.from({ length: n + 1 }, (_, k) => `sig:${k}`);
      const redKeys = Array.from({ length: n }, (_, i) => `red:${i}`);
      const pairOK = n >= 4;
      const pairKeys = pairOK ? PAIR_DV.map(dv => `r34:2:${dv}`) : [];
      buildMapCells([
        { title: '要素減衰比 ζ（全スタンド共通）', keys: ['zeta'], cols: n + 1 },
        { title: '摩擦係数（スタンド別）', keys: muKeys, cols: n + 1 },
        { title: '張力（区間別）', keys: sigKeys, cols: n + 1 },
        { title: '圧下率（スタンド別：そのスタンドの出側板厚を変化、次スタンドの入側も連動）', keys: redKeys, cols: n + 1 },
      ].concat(pairOK ? [{ title: `No.3×No.4 圧下率マップ（速度別：現状 ${PAIR_DV.map(dv => '+' + dv).join(' / ')} m/min、横に並べて比較）`, keys: pairKeys, cols: PAIR_DV.length }] : []));
      const first = [];
      if (pairOK) for (const dv of PAIR_DV) {
        const pg = makePairGrid(2, Math.max(11, Math.round(res * 0.5)), dv);
        first.push(pg);
        if (pg.line.nx) first.push(pg.line);
      }
      S.maps = first.concat(['zeta'].concat(muKeys, sigKeys, redKeys).map(k => makeGrid(k, nx, ny)));
      S.map = null;
    } else {
      const nx = res, ny = res >= 60 ? res : Math.round(res * 0.72);
      S.map = makeGrid($('#mapAxis').value, nx, ny);
      S.maps = null;
    }
    S.mapStale = false;
    updateMapFamilyNote();
    for (const grid of allGrids()) {
      if (worker) worker.postMessage({ jobId: grid.jobId, base, xs: grid.xs, ys: grid.ys, axisKey: grid.axisKey, vFixed: grid.vFixed, family: S.mapFamily });
      else S.mapQueue.push({ grid, base, k: 0, total: grid.nx * grid.ny, family: S.mapFamily });
    }
    if (!worker && S.mapQueue.length) S.mapJob = S.mapQueue[0];
    updateMapProgress();
    drawHeatmap();
  }
  /** advance the map computation within a per-frame time budget (ms) */
  function mapStep(budget) {
    const job = S.mapJob; if (!job) return;
    const { grid, base } = job;
    const t0 = performance.now();
    while (job.k < job.total && performance.now() - t0 < budget) {
      const k = job.k, j = Math.floor(k / grid.nx), i = k % grid.nx;
      let q = null;
      if (grid.special) { q = pairParams(base, grid.axisKey, grid.xs[i], grid.ys[j], grid.vFixed); if (!feasibleSchedule(q)) q = null; }
      else { q = Object.assign({}, base, { vExit: grid.xs[i] }); grid.ax.apply(q, grid.ys[j]); }
      if (!q) { grid.re[k] = NaN; grid.kind[k] = 5; }
      else {
        try {
          const c = pickCritical(M.eigenAnalysis(new M.Line(q), { fmin: 5 }), job.family);
          if (c) { grid.re[k] = c.re; grid.f[k] = c.f; grid.dom[k] = c.domStand; grid.kind[k] = c.kind; } else { grid.re[k] = NaN; grid.kind[k] = -1; }
        }
        catch (e) { grid.re[k] = NaN; grid.kind[k] = 5; }
      }
      job.k++;
    }
    grid.done = job.k;
    updateMapProgress();
    markMapDirty(grid);
    if (job.k >= job.total) {
      S.mapQueue.shift();
      S.mapJob = S.mapQueue[0] || null;
      if (!S.mapJob) renderCritTable();
    }
  }
  let mapGeom = null;
  /** mode family for the map colouring: 0 third, 1 fifth, 3 housing → vertical; 2 horizontal; 6 torsion; 4 tension, 5 other */
  const FAMILIES = [
    { id: 'stable', label: '安定', color: () => TH.mapStable },
    { id: 'vert', label: '垂直振動（上下ギャップ・ロール相対・ハウジング）', color: () => TH.mapVert },
    { id: 'horiz', label: '水平振動', color: () => TH.mapHoriz },
    { id: 'tors', label: 'ねじり振動（駆動系）', color: () => TH.mapTors },
    { id: 'other', label: 'その他（張力・リール・高次）', color: () => TH.mapOther },
  ];
  function familyOf(code) { code = code | 0; return code === 2 ? 2 : code === 6 ? 3 : (code === 0 || code === 1 || code === 3) ? 1 : 4; }
  function kindColor(code) { return FAMILIES[familyOf(code)].color(); }
  /** connected regions of equal (stability, mode kind, stand) → label with median frequency and stand */
  function labelRegions(ctx, g, xOf, yOf, compact, byMode, avoid) {
    const N = g.nx * g.ny, seen = new Uint8Array(N);
    const keyOf = k => (g.re[k] > 0 ? 1 : 0) * 1000 + g.kind[k] * 10 + g.dom[k];
    const minSize = Math.max(4, Math.round(N * (compact ? 0.08 : 0.025)));
    const comps = [];
    const stack = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (seen[s0] || !isFinite(g.re[s0])) continue;
      const key = keyOf(s0); const cells = [];
      stack.length = 0; stack.push(s0); seen[s0] = 1;
      while (stack.length) {
        const k = stack.pop(); cells.push(k);
        const i = k % g.nx, j = Math.floor(k / g.nx);
        const nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
        for (const [ii, jj] of nb) {
          if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
          const kk = jj * g.nx + ii;
          if (!seen[kk] && isFinite(g.re[kk]) && keyOf(kk) === key) { seen[kk] = 1; stack.push(kk); }
        }
      }
      const unstable = g.re[s0] > 0;
      if (cells.length < minSize) continue;
      if (!byMode && !unstable) continue;          // Re-λ colouring: annotate chatter regions only
      const fs = cells.map(k => g.f[k]).sort((a, b) => a - b);
      let sx = 0, sy = 0; for (const k of cells) { sx += xOf(g.xs[k % g.nx]); sy += yOf(g.ys[Math.floor(k / g.nx)]); }
      comps.push({ x: sx / cells.length, y: sy / cells.length, f: fs[Math.floor(fs.length / 2)], dom: g.dom[s0], kind: g.kind[s0], unstable, size: cells.length, key });
    }
    comps.sort((a, b) => b.size - a.size);
    ctx.save();
    ctx.font = `${compact ? 600 : 700} ${compact ? 10 : 11.5}px ${TH.cond}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const placed = [];
    for (const c of comps.slice(0, compact ? 4 : 8)) {
      const text = `${fmtI(c.f)} Hz · No.${c.dom + 1}`;
      const wTxt = ctx.measureText(text).width + 10, hTxt = compact ? 14 : 17;
      const X0 = g.xMin != null ? g.xMin : VMIN, X1 = g.xMax != null ? g.xMax : VMAX;
      const yLo = yOf(g.ax.max) + hTxt / 2 + 2, yHi = yOf(g.ax.min) - hTxt / 2 - 2;
      let x = clamp(c.x, xOf(X0) + wTxt / 2 + 2, xOf(X1) - wTxt / 2 - 2), y = clamp(c.y, yLo, yHi);
      if (placed.some(p => Math.abs(p.x - x) < (p.w + wTxt) / 2 && Math.abs(p.y - y) < hTxt)) y += hTxt + 2;
      if (avoid) {
        const hits = (xx, yy) => avoid.some(p => Math.abs(p.x - xx) < wTxt / 2 + (p.pad || 9) && Math.abs(p.y - yy) < hTxt / 2 + (p.pad || 9));
        // the label must stay over its own region
        const keyAt = (xx, yy) => {
          const i = Math.round((xx - xOf(X0)) / (xOf(X1) - xOf(X0)) * (g.nx - 1));
          const j = Math.round((yy - yOf(g.ax.min)) / (yOf(g.ax.max) - yOf(g.ax.min)) * (g.ny - 1));
          if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
          const kk = j * g.nx + i;
          return isFinite(g.re[kk]) ? keyOf(kk) : null;
        };
        if (hits(x, y) || keyAt(x, y) !== c.key) {
          const xLo = xOf(X0) + wTxt / 2 + 2, xHi = xOf(X1) - wTxt / 2 - 2;
          const cands = [[0, hTxt + 10], [0, -hTxt - 10], [wTxt / 2 + 16, 0], [-wTxt / 2 - 16, 0], [0, 2 * hTxt + 14], [0, -2 * hTxt - 14]];
          const ok = cands.map(([dx, dy]) => [x + dx, y + dy]).find(([xx, yy]) => xx >= xLo && xx <= xHi && yy >= yLo && yy <= yHi && !hits(xx, yy) &&
            keyAt(xx, yy) === c.key && !placed.some(p => Math.abs(p.x - xx) < (p.w + wTxt) / 2 && Math.abs(p.y - yy) < hTxt));
          if (!ok) continue;
          x = ok[0]; y = ok[1];
        }
      }
      placed.push({ x, y, w: wTxt });
      ctx.globalAlpha = c.unstable ? 0.92 : 0.8;
      ctx.fillStyle = TH.panel;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - wTxt / 2, y - hTxt / 2, wTxt, hTxt, 3) : ctx.rect(x - wTxt / 2, y - hTxt / 2, wTxt, hTxt); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.unstable ? TH.critInk : TH.ink2;
      ctx.fillText(text, x, y + 0.5);
    }
    ctx.restore();
  }
  /* incremental redraw: a finished row repaints only its own map (and the pair map for its coupling line),
     coalesced to one paint per animation frame; a changed common colour scale repaints everything */
  const mapDirty = new Set();
  let mapLastVmax = null;
  function markMapDirty(g) { mapDirty.add(g.special === 'pairLine' ? allGrids().find(q => q.line === g) || g : g); }
  function flushMapDraw() {
    if (!mapDirty.size || S.tab !== 'stability') return;
    const vmax = commonVmax();
    if (S.mapMode === 'single' || vmax !== mapLastVmax) { mapDirty.clear(); drawHeatmap(); return; }
    for (const g of mapDirty) {
      const c = mapCanvas.get(g.axisKey);
      if (c) c.__geom = drawGrid(c, g, { compact: true, vmax });
    }
    mapDirty.clear();
  }
  function commonVmax() {
    let vmax = 10;
    for (const g of allGrids()) for (let k = 0; k < g.done; k++) if (isFinite(g.re[k])) vmax = Math.max(vmax, Math.abs(g.re[k]));
    return Math.min(niceCeil(vmax), 80);
  }
  function divColor(v, vmax) {
    const t = clamp(v / vmax, -1, 1);
    if (t < 0) return mix(TH.divMid, TH.divNeg, Math.pow(-t, 0.7));
    return mix(TH.divMid, TH.divPos, Math.pow(t, 0.7));
  }
  function drawHeatmap() {
    mapDirty.clear();
    mapLastVmax = commonVmax();
    if (S.mapMode !== 'single') {
      const vmax = mapLastVmax;
      for (const g of (S.maps || [])) {
        const c = mapCanvas.get(g.axisKey);
        if (c) c.__geom = drawGrid(c, g, { compact: true, vmax });
      }
      return;
    }
    const c = $('#heatmap');
    if (!S.map) { const { ctx, w, h: H } = fitCanvas(c); ctx.clearRect(0, 0, w, H); return; }
    mapGeom = drawGrid(c, S.map, { compact: false, vmax: commonVmax() });
    c.__geom = mapGeom;
  }
  function drawGrid(c, g, opts) {
    const { ctx, w, h: H } = fitCanvas(c);
    ctx.clearRect(0, 0, w, H);
    if (!g) return null;
    const compact = !!opts.compact;
    const left = compact ? 48 : 64, right = compact ? 14 : 74, top = compact ? 10 : 14, bottom = compact ? 30 : 40;
    const pw = w - left - right, ph = H - top - bottom;
    const X0 = g.xMin != null ? g.xMin : VMIN, X1 = g.xMax != null ? g.xMax : VMAX;
    const xOf = v => left + (v - X0) / (X1 - X0) * pw;
    const yOf = v => top + ph - (v - g.ax.min) / (g.ax.max - g.ax.min) * ph;
    const vmax = opts.vmax || 10;
    const cw = pw / (g.nx - 1), ch = ph / (g.ny - 1);
    const byMode = S.mapColor === 'mode';
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, pw, ph); ctx.clip();
    for (let k = 0; k < g.done; k++) {
      const j = Math.floor(k / g.nx), i = k % g.nx;
      const v = g.re[k];
      if (!isFinite(v)) ctx.fillStyle = TH.panel3;
      else if (byMode) ctx.fillStyle = v > 0 ? kindColor(g.kind[k]) : TH.mapStable;
      else ctx.fillStyle = divColor(v, vmax);
      ctx.fillRect(xOf(g.xs[i]) - cw / 2, yOf(g.ys[j]) - ch / 2, cw + 0.6, ch + 0.6);
    }
    if (g.special === 'pair') {
      // infeasible schedule (next stand would thicken the strip, or a pass above 70 %): hatched
      ctx.save(); ctx.beginPath();
      let any = false;
      for (let k = 0; k < g.done; k++) {
        if (isFinite(g.re[k]) || g.kind[k] === -1) continue;
        any = true;
        ctx.rect(xOf(g.xs[k % g.nx]) - cw / 2, yOf(g.ys[Math.floor(k / g.nx)]) - ch / 2, cw + 0.6, ch + 0.6);
      }
      if (any) {
        ctx.clip();
        ctx.globalAlpha = 0.5; ctx.strokeStyle = TH.ink3; ctx.lineWidth = 1; ctx.beginPath();
        for (let d = -ph; d < pw + ph; d += 6) { ctx.moveTo(left + d, top + ph); ctx.lineTo(left + d + ph, top); }
        ctx.stroke();
      }
      ctx.restore();
    }
    // zero contour (marching squares, linear interpolation)
    if (g.done === g.nx * g.ny) {
      ctx.strokeStyle = TH.panel; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      const val = (i, j) => g.re[j * g.nx + i];
      const interp = (a, b, va, vb) => a + (b - a) * (0 - va) / (vb - va);
      for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
        const v00 = val(i, j), v10 = val(i + 1, j), v01 = val(i, j + 1), v11 = val(i + 1, j + 1);
        if (![v00, v10, v01, v11].every(isFinite)) continue;
        const pts = [];
        const x0 = xOf(g.xs[i]), x1 = xOf(g.xs[i + 1]), y0 = yOf(g.ys[j]), y1 = yOf(g.ys[j + 1]);
        if ((v00 < 0) !== (v10 < 0)) pts.push([interp(x0, x1, v00, v10), y0]);
        if ((v10 < 0) !== (v11 < 0)) pts.push([x1, interp(y0, y1, v10, v11)]);
        if ((v01 < 0) !== (v11 < 0)) pts.push([interp(x0, x1, v01, v11), y1]);
        if ((v00 < 0) !== (v01 < 0)) pts.push([x0, interp(y0, y1, v00, v01)]);
        if (pts.length >= 2) { ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); }
        if (pts.length === 4) { ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); }
      }
      ctx.stroke();
      ctx.strokeStyle = TH.ink; ctx.lineWidth = 1; ctx.stroke();
    }
    // region labels: dominant frequency and stand
    if (g.done === g.nx * g.ny) labelRegions(ctx, g, xOf, yOf, compact, byMode, g.special === 'pair' ? pairMarkers(g, xOf, yOf) : null);
    // closed-form estimate (dotted)
    if (g.approx && familyHasApprox()) {
      ctx.save();
      ctx.setLineDash([2, 4]); ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = TH.brass;
      ctx.beginPath(); let pen = false;
      for (let j = 0; j < g.ny; j++) {
        const v = g.approx[j];
        if (!isFinite(v) || v < VMIN || v > VMAX) { pen = false; continue; }
        const x = xOf(v), y = yOf(g.ys[j]);
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
      ctx.restore();
    }
    if (g.special === 'pair') drawPairOverlay(ctx, g, xOf, yOf, left, top, pw, ph, compact);
    ctx.restore();
    // axes
    ctx.strokeStyle = TH.line; ctx.lineWidth = 1;
    ctx.strokeRect(left - 0.5, top - 0.5, pw + 1, ph + 1);
    ctx.fillStyle = TH.ink3; ctx.font = `${compact ? 10 : 11}px ${TH.mono}`; ctx.textAlign = 'center';
    if (g.xAx) {
      for (let v = Math.ceil(X0 * 10 - 1e-9) / 10; v <= X1 + 1e-9; v += 0.1) ctx.fillText(String(Math.round(v * 100)), xOf(v), H - bottom + 14);
      ctx.font = `600 ${compact ? 10 : 11}px ${TH.cond}`; ctx.fillText(`${g.xAx.label} %`, left + pw / 2, H - 4);
    } else {
      for (let v = compact ? 1000 : 500; v <= VMAX; v += compact ? 1000 : 500) ctx.fillText(String(v), xOf(v), H - bottom + 14);
      ctx.font = `600 ${compact ? 10 : 11}px ${TH.cond}`; ctx.fillText(compact ? 'm/min' : 'EXIT SPEED  m/min', left + pw / 2, H - 4);
    }
    ctx.font = `${compact ? 10 : 11}px ${TH.mono}`; ctx.textAlign = 'right';
    for (let k = 0; k <= (compact ? 2 : 4); k++) { const v = g.ax.min + (g.ax.max - g.ax.min) * k / (compact ? 2 : 4); ctx.fillText(g.ax.fmt(v), left - 5, yOf(v) + 4); }
    if (!compact) {
      ctx.save(); ctx.translate(14, top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.font = `600 11px ${TH.cond}`; ctx.fillText(g.ax.label.toUpperCase(), 0, 0); ctx.restore();
      // colorbar
      const cbx = w - right + 18, cbw = 12;
      for (let y = 0; y < ph; y++) {
        const v = vmax * (1 - 2 * y / ph);
        ctx.fillStyle = divColor(v, vmax); ctx.fillRect(cbx, top + y, cbw, 1.5);
      }
      ctx.strokeStyle = TH.line; ctx.strokeRect(cbx - 0.5, top - 0.5, cbw + 1, ph + 1);
      ctx.fillStyle = TH.ink3; ctx.font = `10.5px ${TH.mono}`; ctx.textAlign = 'left';
      ctx.fillText(`+${vmax}`, cbx + cbw + 4, top + 9); ctx.fillText('0', cbx + cbw + 4, top + ph / 2 + 4); ctx.fillText(`−${vmax}`, cbx + cbw + 4, top + ph);
      ctx.save(); ctx.translate(cbx + cbw + 4, top + ph / 2 + 30); ctx.rotate(Math.PI / 2); ctx.font = `600 10px ${TH.cond}`; ctx.fillText('Re λ  1/s', 0, 0); ctx.restore();
    }
    // current point
    const cy = g.ax.cur(), cx0 = g.special === 'pair' ? g.r3cur : P.vExit;
    if (cy >= g.ax.min && cy <= g.ax.max && (g.special !== 'pair' || (cx0 >= X0 && cx0 <= X1))) {
      const x = xOf(cx0), y = yOf(cy);
      ctx.fillStyle = TH.ink; ctx.strokeStyle = TH.panel; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (g.special === 'pair') renderPairNotes();
    return { left, top, pw, ph, xOf, yOf, vmax };
  }
  function drawStar(ctx, x, y, r, fill, stroke) {
    ctx.save(); ctx.setLineDash([]); ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      const px = x + rr * Math.cos(a), py = y + rr * Math.sin(a);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.restore();
  }
  /** spread (max − min) of the finite Re λ values; below PAIR_FLAT the "best" split is numerical noise */
  const PAIR_FLAT = 0.5;
  function reSpread(G) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < G.done; i++) if (isFinite(G.re[i])) { lo = Math.min(lo, G.re[i]); hi = Math.max(hi, G.re[i]); }
    return hi >= lo ? hi - lo : NaN;
  }
  /** true when a finished grid holds only "no mode of the selected family" cells (kind −1) and infeasible cells */
  const noFamilyGrid = G => G.done > 0 && !Array.prototype.some.call(G.re, v => isFinite(v)) && Array.prototype.some.call(G.kind, k => k === -1);
  /** index of the minimum finite Re λ in a (completed part of a) grid */
  function argminRe(G) {
    let bi = -1;
    for (let i = 0; i < G.done; i++) if (isFinite(G.re[i]) && (bi < 0 || G.re[i] < G.re[bi])) bi = i;
    return bi;
  }
  /** screen positions of the pair-map markers (◇ current, ★ line best, ○ plane best) */
  function pairMarkers(g, xOf, yOf) {
    const out = [{ x: xOf(g.r3cur), y: yOf(g.r4cur) }];
    const L = g.line;
    if (L && L.nx) for (const r3 of L.xs) out.push({ x: xOf(r3), y: yOf(1 - g.k / (1 - r3)), pad: 4 });
    if (L && L.nx && L.done >= L.nx && !(reSpread(L) < PAIR_FLAT)) { const bi = argminRe(L); if (bi >= 0) out.push({ x: xOf(L.xs[bi]), y: yOf(1 - g.k / (1 - L.xs[bi])) }); }
    if (g.done >= g.nx * g.ny && !(reSpread(g) < PAIR_FLAT)) { const bi = argminRe(g); if (bi >= 0) out.push({ x: xOf(g.xs[bi % g.nx]), y: yOf(g.ys[Math.floor(bi / g.nx)]) }); }
    return out;
  }
  /** coupling line (only No.s+1 and No.s+2 change), best points, and dimming when No.s+2 is the last stand */
  function drawPairOverlay(ctx, g, xOf, yOf, left, top, pw, ph, compact) {
    if (g.lastStand) { ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = TH.panel; ctx.fillRect(left, top, pw, ph); ctx.restore(); }
    const L = g.line;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = TH.ink;
    if (L && L.nx) {
      const pts = L.xs.map((r3, i) => ({ x: xOf(r3), y: yOf(1 - g.k / (1 - r3)), re: i < L.done ? L.re[i] : NaN, none: i < L.done && L.kind[i] === -1 }));
      ctx.save(); ctx.strokeStyle = TH.panel; ctx.lineWidth = 6.5; ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.restore();
      // split at stability changes, then stroke each same-style run as ONE path so the dash pattern is continuous
      const subs = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        if (a.none || b.none) subs.push([a, b, 'n']);
        else if (!(isFinite(a.re) && isFinite(b.re))) subs.push([a, b, 'u']);
        else if ((a.re < 0) === (b.re < 0)) subs.push([a, b, a.re < 0 ? 's' : 'x']);
        else {
          const t = a.re / (a.re - b.re), m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          subs.push([a, m, a.re < 0 ? 's' : 'x'], [m, b, b.re < 0 ? 's' : 'x']);
        }
      }
      const STY = { u: { dash: [2, 3], w: 1.4 }, s: { dash: [], w: 3.4 }, x: { dash: [6, 4], w: 2 }, n: { dash: [], w: 1, alpha: 0.35 } };
      for (let k0 = 0; k0 < subs.length;) {
        const st = subs[k0][2];
        ctx.setLineDash(STY[st].dash); ctx.lineWidth = STY[st].w; ctx.globalAlpha = STY[st].alpha || 1;
        ctx.beginPath(); ctx.moveTo(subs[k0][0].x, subs[k0][0].y);
        let k1 = k0;
        while (k1 < subs.length && subs[k1][2] === st) { ctx.lineTo(subs[k1][1].x, subs[k1][1].y); k1++; }
        ctx.stroke();
        k0 = k1;
      }
      ctx.globalAlpha = 1;
      if (L.done >= L.nx && !(reSpread(L) < PAIR_FLAT)) { const bi = argminRe(L); if (bi >= 0) drawStar(ctx, pts[bi].x, pts[bi].y, compact ? 6.5 : 8.5, TH.brass, TH.panel); }
    }
    if (g.done >= g.nx * g.ny && !(reSpread(g) < PAIR_FLAT)) {
      const bi = argminRe(g);
      if (bi >= 0) {
        const x = xOf(g.xs[bi % g.nx]), y = yOf(g.ys[Math.floor(bi / g.nx)]);
        ctx.setLineDash([]);
        ctx.strokeStyle = TH.panel; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, compact ? 5 : 6.5, 0, TWO_PI); ctx.stroke();
        ctx.strokeStyle = TH.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, compact ? 5 : 6.5, 0, TWO_PI); ctx.stroke();
      }
    }
    ctx.restore();
  }
  /** comparison of the No.3×No.4 maps at every speed: one table row per speed */
  function renderPairNotes() {
    const el = $('#pairNote'); if (!el) return;
    const gs = (S.maps || []).filter(q => q.special === 'pair').sort((p, q) => p.dv - q.dv);
    if (!gs.length) return;
    const pct = v => `${(v * 100).toFixed(1)} %`, sgn = v => `${v >= 0 ? '+' : ''}${fmt(v, 1)}`;
    const g0 = gs[0], a = g0.s + 1, b = g0.s + 2, c = g0.s + 3;
    const head = `No.${a}×No.${b} 圧下率マップ ― 速度 ${gs.map(g => fmtI(g.vFixed)).join(' / ')} m/min（現状 ${gs.map(g => '+' + g.dv).join(' / ')}）、最終出側板厚 ${g0.hExit.toFixed(3)} mm 一定。` +
      (g0.lastStand ? `No.${b} が最終スタンドのため、出側板厚一定になるのは実線上のみ（面は参考表示）。` : `面の各点は No.${c} の圧下率で板厚を保持。実線は No.${a}・No.${b} だけで配分替え（No.${b} 出側板厚も一定）。`);
    const stateTxt = re => `Re λ ${sgn(re)} /s（${re > 0 ? '不安定' : '安定'}）`;
    const famTxt = S.mapFamily === 'all' ? '' : `対象モード = ${FAMILY_LABEL[S.mapFamily]}。`;
    const rows = gs.map(g => {
      const cells = [h('td', { class: 'n' }, `${fmtI(g.vFixed)}`, h('span', { class: 'u' }, ` m/min（+${g.dv}）`))];
      // ◇ current split
      cells.push(h('td', { class: 't' + (g.cur && g.cur.re > 0 ? ' bad' : '') }, g.cur
        ? `No.${a} ${pct(g.r3cur)} / No.${b} ${pct(g.r4cur)}: ${stateTxt(g.cur.re)} · ${fmtI(g.cur.f)} Hz · No.${g.cur.dom + 1}` : S.mapFamily !== 'all' ? `対象モード（${FAMILY_LABEL[S.mapFamily]}）なし` : '—'));
      // ★ best on the coupling line, and its stable intervals
      const L = g.line;
      const noneTxt = `対象モード（${FAMILY_LABEL[S.mapFamily]}）なし`;
      const flatTxt = G => { let v = NaN; for (let i = 0; i < G.done; i++) if (isFinite(G.re[i])) { v = G.re[i]; break; } return `差なし（どの配分でも ${stateTxt(v)}）`; };
      if (L && L.nx && L.done >= L.nx) {
        if (noFamilyGrid(L)) cells.push(h('td', { class: 't' }, noneTxt), h('td', { class: 't' }, noneTxt));
        else {
          const bi = argminRe(L), flat = reSpread(L) < PAIR_FLAT;
          cells.push(h('td', { class: 't' + (bi >= 0 && L.re[bi] > 0 ? ' bad' : '') }, bi < 0 ? '—' : flat ? flatTxt(L)
            : `No.${a} ${pct(L.xs[bi])} / No.${b} ${pct(1 - g.k / (1 - L.xs[bi]))}: ${stateTxt(L.re[bi])} · ${fmtI(L.f[bi])} Hz · No.${L.dom[bi] + 1}`));
          const iv = []; let start = null;
          const zero = i => L.xs[i] + (L.xs[i + 1] - L.xs[i]) * L.re[i] / (L.re[i] - L.re[i + 1]);
          for (let i = 0; i < L.nx; i++) {
            const st = isFinite(L.re[i]) && L.re[i] < 0;
            if (st && start == null) start = i > 0 && isFinite(L.re[i - 1]) ? zero(i - 1) : L.xs[i];
            const nextSt = i + 1 < L.nx && isFinite(L.re[i + 1]) && L.re[i + 1] < 0;
            if (st && !nextSt) { iv.push([start, i + 1 < L.nx && isFinite(L.re[i + 1]) ? zero(i) : L.xs[i]]); start = null; }
          }
          cells.push(h('td', { class: 't' + (iv.length || bi < 0 ? '' : ' bad') }, iv.length ? `No.${a} ${iv.map(([p, q]) => `${(p * 100).toFixed(0)}–${(q * 100).toFixed(0)}`).join('、')} %` : bi < 0 ? '—' : 'なし（配分替えだけでは安定化しない）'));
        }
      } else if (L && L.nx) cells.push(h('td', { class: 't', colspan: 2 }, `実線（配分替え）を計算中 ${Math.round(100 * L.done / L.nx)} %`));
      else cells.push(h('td', { class: 't' }, '—'), h('td', { class: 't' }, '—'));
      // ○ best over the plane
      if (g.done >= g.nx * g.ny) {
        const bi = argminRe(g);
        if (noFamilyGrid(g)) cells.push(h('td', { class: 't' }, noneTxt));
        else if (bi >= 0 && reSpread(g) < PAIR_FLAT) cells.push(h('td', { class: 't' + (g.re[bi] > 0 ? ' bad' : '') }, flatTxt(g)));
        else if (bi >= 0) {
          const r3 = g.xs[bi % g.nx], r4 = g.ys[Math.floor(bi / g.nx)];
          const r5 = g.hNext != null ? 1 - g.hNext / (g.hin * (1 - r3) * (1 - r4)) : null;
          cells.push(h('td', { class: 't' + (g.re[bi] > 0 ? ' bad' : '') }, `No.${a} ${pct(r3)} / No.${b} ${pct(r4)}${r5 != null ? ` / No.${c} ${pct(r5)}` : ''}: ${stateTxt(g.re[bi])}`));
        } else cells.push(h('td', { class: 't' }, '—'));
      } else cells.push(h('td', { class: 't' }, `計算中 ${Math.round(100 * g.done / (g.nx * g.ny))} %`));
      return h('tr', null, ...cells);
    });
    const table = h('table', { class: 'data pair-table' },
      h('tr', null, ...['速度', '◇ 現状の配分', '★ 実線上の最安定', `太線 = 安定な配分（No.${a}）`, '○ 面内の最安定'].map(t => h('th', null, t))),
      ...rows);
    const headEl = h('div', null, famTxt + head);
    const sig = headEl.textContent + '|' + Array.from(table.querySelectorAll('td')).map(td => td.className + ':' + td.textContent).join('|');
    if (el.__sig === sig) return;                     // repaint with identical content: keep the DOM (scroll, selection)
    el.__sig = sig;
    const old = el.querySelector('.table-wrap'), sx = old ? old.scrollLeft : 0;
    el.replaceChildren(headEl, h('div', { class: 'table-wrap' }, table));
    if (sx) el.querySelector('.table-wrap').scrollLeft = sx;
  }
  function bindMapHover(c, gridOf) {
    const tip = $('#tipMap');
    c.addEventListener('mousemove', e => {
      const g = gridOf(); const geom = c.__geom; if (!g || !geom) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const fx = (x - geom.left) / geom.pw, fy = 1 - (y - geom.top) / geom.ph;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) { tip.hidden = true; return; }
      const i = Math.round(fx * (g.nx - 1)), j = Math.round(fy * (g.ny - 1)), k = j * g.nx + i;
      if (k >= g.done) { tip.hidden = true; return; }
      const v = g.re[k];
      if (g.special === 'pair') {
        const r3 = g.xs[i], r4 = g.ys[j];
        const r5 = g.hNext != null ? 1 - g.hNext / (g.hin * (1 - r3) * (1 - r4)) : null;
        const pct = t => `${(t * 100).toFixed(1)} %`;
        const head = `No.${g.s + 1} ${pct(r3)} · No.${g.s + 2} ${pct(r4)}${r5 != null ? ` · No.${g.s + 3} ${pct(r5)}` : ''} · ${fmtI(g.vFixed)} m/min`;
        if (!isFinite(v)) { showTip(tip, c, x, y, `${head}<br>${g.kind[k] === -1 ? `対象モード（${FAMILY_LABEL[S.mapFamily]}）なし` : g.lastStand ? '実行不可（1 パス 70 % 超、または計算不可）' : `実行不可（No.${g.s + 3} の圧下率が負、または 1 パス 70 % 超）`}`); return; }
        const kn2 = M.MODE_KINDS[clamp(g.kind[k] | 0, 0, 6)].label;
        showTip(tip, c, x, y, `${head}<br>Re λ ${v >= 0 ? '+' : ''}${fmt(v, 1)} /s · ${fmtI(g.f[k])} Hz · No.${g.dom[k] + 1} · ${kn2}<br>${v > 0 ? '不安定（チャタリング）' : '安定'}`);
        return;
      }
      if (!isFinite(v)) { showTip(tip, c, x, y, `${g.ax.label} ${g.ax.fmt(g.ys[j])} · ${fmtI(g.xs[i])} m/min<br>${g.kind[k] === -1 ? `対象モード（${FAMILY_LABEL[S.mapFamily]}）なし` : '計算不可'}`); return; }
      const ap = g.approx && familyHasApprox() ? g.approx[j] : NaN;
      const kn = M.MODE_KINDS[clamp(g.kind[k] | 0, 0, 6)].label;
      showTip(tip, c, x, y, `${g.ax.label} ${g.ax.fmt(g.ys[j])} · ${fmtI(g.xs[i])} m/min<br>Re λ ${v >= 0 ? '+' : ''}${fmt(v, 1)} /s · ${fmtI(g.f[k])} Hz · No.${g.dom[k] + 1} · ${kn}<br>${v > 0 ? '不安定（チャタリング）' : '安定'}${isFinite(ap) ? ` · 近似式 ${fmtI(ap)} m/min` : ''}`);
    });
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
  }
  bindMapHover($('#heatmap'), () => S.map);
  function buildMapCells(groups) {
    const box = $('#mapMulti');
    box.textContent = '';
    mapCanvas.clear();
    for (const grp of groups) {
      if (grp.title) box.append(h('div', { class: 'map-group-title' }, grp.title));
      const grid = h('div', { class: 'map-grid', style: grp.cols ? `--mc:${grp.cols}` : '' });
      for (const k of grp.keys) {
        let title;
        if (k.startsWith('r34:')) { const [, s, dv] = k.split(':').map(Number); title = `No.${s + 1}×No.${s + 2} · ${fmtI(P.vExit + dv)} m/min（現状 +${dv}）`; }
        else title = axisFor(k).label;
        const c = h('canvas', { class: 'chart h-cell' });
        const cell = h('div', { class: 'map-cell' + (k.startsWith('r34:') ? ' map-cell-pair' : '') }, h('div', { class: 'map-cell-title' }, title), c);
        grid.append(cell);
        mapCanvas.set(k, c);
        bindMapHover(c, () => (S.maps || []).find(g => g.axisKey === k));
      }
      box.append(grid);
      if (grp.keys.some(k => k.startsWith('r34:'))) {
        box.append(h('div', { class: 'map-pair-note', id: 'pairNote' }, h('div', null, 'No.3×No.4 圧下率マップを計算中…')));
        box.append(h('div', { class: 'map-pair-legend fine' }, `◇ 現状　★ 実線上の最安定　○ 面内の最安定（値の差が ${PAIR_FLAT} /s 未満のときは表示しない）　太い実線 = 安定な配分替え、破線 = 不安定、点線 = 未計算、淡い細線 = 対象モードなし　斜線 = 実行不可（${nS() > 4 ? 'No.5 の圧下率が負、または 1 パス 70 % 超' : '1 パス 70 % 超、または計算不可'}）　灰色 = 対象モードなし`));
      }
    }
  }
  const FAMILY_LABEL = { all: '全モード', vert: '垂直', horiz: '水平', tors: 'ねじり' };
  /** the closed-form estimate is a vertical gap-mode balance: show it only for all / vertical */
  const familyHasApprox = () => S.mapFamily === 'all' || S.mapFamily === 'vert';
  const apxTxt = (g, j) => familyHasApprox() && g.approx && isFinite(g.approx[j]) ? fmtI(g.approx[j]) : '—';
  function critOfRow(g, j) {
    let crit = null, fm = null, dom = null;
    for (let i = 0; i < g.nx - 1; i++) {
      const a = g.re[j * g.nx + i], b = g.re[j * g.nx + i + 1];
      if (a <= 0 && b > 0) { crit = g.xs[i] + (g.xs[i + 1] - g.xs[i]) * (0 - a) / (b - a); fm = g.f[j * g.nx + i + 1]; dom = g.dom[j * g.nx + i + 1]; break; }
    }
    let first = NaN;
    for (let i = 0; i < g.nx; i++) if (isFinite(g.re[j * g.nx + i])) { first = g.re[j * g.nx + i]; break; }
    if (crit == null && !isFinite(first)) return { crit: null, txt: '—', fm: null, dom: null };
    return { crit, txt: crit != null ? fmtI(crit) : first > 0 ? `< ${VMIN}` : `> ${VMAX}`, fm, dom };
  }
  function renderCritTable() {
    const tbl = $('#critTable');
    tbl.textContent = '';
    if (S.mapMode !== 'single') {
      if (!S.maps) return;
      tbl.append(h('tr', null, h('th', null, '縦軸'), h('th', null, '現在値'), h('th', null, '臨界速度（現在値の行）'), h('th', null, '近似式'), h('th', null, '−20 % の行'), h('th', null, '+20 % の行'), h('th', null, '限界でのモード')));
      for (const g of S.maps) {
        if (g.special) continue;
        const cur = g.ax.cur();
        if (!isFinite(cur)) continue;
        const rowAt = v => clamp(Math.round((v - g.ax.min) / (g.ax.max - g.ax.min) * (g.ny - 1)), 0, g.ny - 1);
        const j = rowAt(cur), jm = rowAt(cur * 0.8), jp = rowAt(cur * 1.2);
        const r0 = critOfRow(g, j), rm = critOfRow(g, jm), rp = critOfRow(g, jp);
        tbl.append(h('tr', null, h('td', { class: 't' }, g.ax.label), h('td', null, g.ax.fmt(cur)), h('td', null, r0.txt), h('td', null, apxTxt(g, j)), h('td', null, rm.txt), h('td', null, rp.txt),
          h('td', { class: 't' }, r0.fm != null ? `${fmtI(r0.fm)} Hz · No.${r0.dom + 1}` : '—')));
      }
      return;
    }
    const g = S.map;
    if (!g) return;
    tbl.append(h('tr', null, h('th', null, g.ax.label), h('th', null, '臨界速度 m/min'), h('th', null, '近似式 m/min'), h('th', null, '限界でのモード'), h('th', null, '主スタンド')));
    const rowsEvery = Math.max(1, Math.round(g.ny / 10));
    for (let j = 0; j < g.ny; j += rowsEvery) {
      const r = critOfRow(g, j);
      tbl.append(h('tr', null, h('td', null, g.ax.fmt(g.ys[j])), h('td', null, r.txt), h('td', null, apxTxt(g, j)),
        h('td', null, r.fm != null ? fmtI(r.fm) + ' Hz' : '—'),
        h('td', { class: 't' }, r.dom != null ? `No.${r.dom + 1}` : '—')));
    }
  }
  $('#mapAxis').addEventListener('change', () => { S.mapStale = true; scheduleMap(); });
  function setMapMode(mode) {
    S.mapMode = mode;
    $$('#mapMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    $('#heatmap').hidden = mode !== 'single';
    $('#mapMulti').hidden = mode === 'single';
    $('#mapAxisWrap').hidden = mode !== 'single';
    try { localStorage.setItem('chatterlab.mapMode', mode); } catch (e) { /* ignore */ }
    S.mapStale = true; if (S.tab === 'stability') scheduleMap();
  }
  $$('#mapMode button').forEach(b => b.addEventListener('click', () => setMapMode(b.dataset.mode)));
  function setMapColor(mode) {
    S.mapColor = mode;
    $$('#mapColor button').forEach(b => b.classList.toggle('on', b.dataset.color === mode));
    const lg = $('#mapLegend');
    lg.textContent = '';
    lg.hidden = mode !== 'mode';
    if (mode === 'mode') {
      FAMILIES.forEach(f => lg.append(h('span', null, h('span', { class: 'swatch', style: `background:${f.color()}` }), f.label)));
      lg.append(h('span', { class: 'fine', style: 'margin:0' }, '色 = 不安定域の最不安定モードの種類。細かい種別（3次／5次など）はホバーとラベルで表示。'));
    }
    try { localStorage.setItem('chatterlab.mapColor', mode); } catch (e) { /* ignore */ }
    drawHeatmap();
  }
  $$('#mapColor button').forEach(b => b.addEventListener('click', () => setMapColor(b.dataset.color)));
  function setMapFamily(fam) {
    S.mapFamily = Object.prototype.hasOwnProperty.call(FAMILY_LABEL, fam) ? fam : 'all';
    $$('#mapFamily button').forEach(b => b.classList.toggle('on', b.dataset.family === S.mapFamily));
    try { localStorage.setItem('chatterlab.mapFamily', S.mapFamily); } catch (e) { /* ignore */ }
    updateMapFamilyNote();
    S.mapStale = true; if (S.tab === 'stability') scheduleMap();
  }
  function updateMapFamilyNote() {
    const el = $('#mapFamilyNote'); if (!el) return;
    const f = S.mapFamily;
    let t = '', warn = false;
    if (f === 'tors' && !P.torsOn) { t = '駆動系のねじり自由度が無効なので、ねじりモードが存在しない（マップは灰色）。パラメータ欄「駆動系ねじり振動」の「電動機–スピンドル–WR のねじり振動を考慮」にチェックを入れると判別できる。'; warn = true; }
    else if (f === 'horiz' && !P.horizOn) { t = '水平自由度が無効なので、水平モードが存在しない（マップは灰色）。パラメータ欄「水平方向（全ロール）」の「全ロールの水平（圧延方向）自由度を含める」にチェックを入れると判別できる。'; warn = true; }
    else if (f === 'vert') t = '対象 = 垂直：上下ギャップ（3次）・ロール相対（5次）・ハウジング伸びが支配的なモードだけで最大の Re λ を取って判別。';
    else if (f === 'horiz') t = '対象 = 水平：圧延方向の変位が支配的なモードだけで最大の Re λ を取って判別。金色の近似式は垂直ギャップモード用なので表示しない。';
    else if (f === 'tors') t = '対象 = ねじり：駆動系ねじりが支配的なモードだけで最大の Re λ を取って判別。金色の近似式は垂直ギャップモード用なので表示しない。';
    el.textContent = t; el.hidden = !t; el.classList.toggle('warn', warn);
  }
  $$('#mapFamily button').forEach(b => b.addEventListener('click', () => setMapFamily(b.dataset.family)));
  try { const mf = localStorage.getItem('chatterlab.mapFamily'); if (mf) setMapFamily(mf); } catch (e) { /* ignore */ }
  try { setMapColor(localStorage.getItem('chatterlab.mapColor') === 'mode' ? 'mode' : 're'); } catch (e) { setMapColor('re'); }
  try { const mm = localStorage.getItem('chatterlab.mapMode'); setMapMode(mm === 'all' || mm === 'stand' ? mm : 'single'); } catch (e) { setMapMode('single'); }
  $('#mapRes').addEventListener('change', () => { S.mapStale = true; scheduleMap(); });

  /* ================================================================
   * tabs, drawer, loop
   * ================================================================ */
  function setTab(name) {
    S.tab = name;
    $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tabpanel').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
    if (name === 'stability' && S.mapStale) scheduleMap();
    if (name === 'overview') drawModeBands();
    if (name === 'stability') drawHeatmap();
    if (name === 'doc') typesetDoc();
    try { localStorage.setItem('chatterlab.tab', name); } catch (e) { /* ignore */ }
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });
  let docTypeset = false, docTries = 0;
  function typesetDoc() {
    if (docTypeset) return;
    const mj = window.MathJax;
    if (!mj || !mj.typesetPromise) {
      if (docTries++ < 60) setTimeout(typesetDoc, 500);     // MathJax still loading (or blocked): retry for 30 s
      return;
    }
    docTypeset = true;
    mj.typesetPromise([$('#tab-doc')]).catch(() => { docTypeset = false; });
  }
  // in-page anchors inside the doc tab
  $('#tab-doc').addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const t = document.getElementById(a.getAttribute('href').slice(1)); if (!t) return;
    e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const aside = $('#params'), backdrop = $('#backdrop');
  function toggleDrawer(open) {
    const o = open == null ? !aside.classList.contains('open') : open;
    aside.classList.toggle('open', o); backdrop.classList.toggle('show', o);
    $('#btnParams').setAttribute('aria-expanded', String(o));
  }
  /* ================================================================
   * conditions ↔ JSON
   * ================================================================ */
  const APP_VERSION = 21;
  function currentUI() {
    return {
      timeScale: S.timeScale, scopeWin: S.scopeWin, coilGuide: S.coilGuide, breakAmp: S.sim ? S.sim.breakAmp : 150,
      noise_kN: S.sim ? S.sim.noise / 1000 : 2, delay: S.sim ? S.sim.delay : true, entry: Object.assign({}, S.entry),
      specScale: S.specScale, gaugeOverlay: S.gaugeOverlay, spgSrc: SPG.src, mapMode: S.mapMode, mapFamily: S.mapFamily, mapAxis: $('#mapAxis').value, mapRes: $('#mapRes').value, mapColor: S.mapColor,
      density: document.documentElement.getAttribute('data-density') || 'compact',
    };
  }
  function exportConditions() {
    const params = JSON.parse(JSON.stringify(P));
    return { app: 'Tandem Chatter Lab', version: APP_VERSION, exported: new Date().toISOString(), params, ui: currentUI() };
  }
  const isNum = v => typeof v === 'number' && isFinite(v);
  /** merge a conditions object into P (whitelist of known keys, shape checks); returns list of notes */
  function importConditions(obj) {
    const notes = [];
    const src = (obj && typeof obj === 'object' && obj.params && typeof obj.params === 'object') ? obj.params : obj;
    if (!src || typeof src !== 'object') throw new Error('JSON のトップレベルがオブジェクトではない');
    const def = M.defaultParams();
    const next = JSON.parse(JSON.stringify(P));
    let ignored = 0;
    for (const [k, v] of Object.entries(src)) {
      if (!(k in def)) { ignored++; continue; }
      const d = def[k];
      if (Array.isArray(d)) {
        if (!Array.isArray(v)) { notes.push(`${k}: 配列でないので無視`); continue; }
        if (k === 'standTypes') next[k] = v.map(t => (t === '6Hi' || t === '20Hi') ? t : '4Hi');
        else { const arr = v.map(Number); if (arr.every(isNum)) next[k] = arr; else notes.push(`${k}: 数値でない要素があるので無視`); }
      } else if (d && typeof d === 'object') {
        if (!v || typeof v !== 'object') { notes.push(`${k}: オブジェクトでないので無視`); continue; }
        for (const [kk, vv] of Object.entries(v)) { if (kk in d && isNum(Number(vv))) next[k][kk] = Number(vv); }
      } else if (typeof d === 'boolean') next[k] = !!v;
      else if (typeof d === 'number') { const n = Number(v); if (isNum(n)) next[k] = n; else notes.push(`${k}: 数値でないので無視`); }
      else next[k] = v;
    }
    // shape consistency around the stand count
    const n = clamp(Math.round(next.h.length), 1, 6);
    next.h = next.h.slice(0, n);
    const fill = (arr, len, val) => { arr = arr.slice(0, len); while (arr.length < len) arr.push(arr.length ? arr[arr.length - 1] : val); return arr; };
    next.mu = fill(next.mu, n, 0.03);
    next.standTypes = fill(next.standTypes, n, '4Hi').map(t => (n > 1 && t === '20Hi') ? '4Hi' : t);
    next.sigma = fill(next.sigma, n + 1, 100);
    if (n === 1) next.reelOn = true;
    if (ignored) notes.push(`不明なキー ${ignored} 件は無視`);
    for (const k of Object.keys(next)) P[k] = next[k];
    S.selStand = Math.min(S.selStand, n - 1); S.selMode = null;
    buildParams();
    markDirty(true);
    if (S.sim) S.sim.reset();
    // display settings (optional)
    const ui = obj && obj.ui;
    if (ui && typeof ui === 'object') {
      const setSel = (id, v) => { const el = $('#' + id); if (!el || v == null) return; el.value = String(v); el.dispatchEvent(new Event('change')); };
      const setNum = (id, v) => { const el = $('#' + id); if (!el || !isNum(Number(v))) return; el.value = v; el.dispatchEvent(new Event('input')); };
      setSel('timeScale', ui.timeScale); setSel('scopeWin', ui.scopeWin);
      setNum('coilGuide', ui.coilGuide); setNum('breakAmp', ui.breakAmp); setNum('noiseLvl', ui.noise_kN);
      if (typeof ui.delay === 'boolean') { $('#delayOn').checked = ui.delay; $('#delayOn').dispatchEvent(new Event('change')); }
      if (ui.entry && typeof ui.entry === 'object') { setSel('entryType', ui.entry.type); setNum('entryAmp', ui.entry.amp); setNum('entryFreq', ui.entry.freq); }
      if (ui.specScale) setScale(ui.specScale === 'auto' ? 'auto' : 'thresh');
      if (typeof ui.gaugeOverlay === 'boolean') setOverlay(ui.gaugeOverlay);
      if (ui.spgSrc && SPG_SRC[ui.spgSrc]) { SPG.src = ui.spgSrc; spgClear(); bindSpgChips(); }
      if (ui.mapAxis && AXES[ui.mapAxis]) $('#mapAxis').value = ui.mapAxis;
      if (ui.mapRes) $('#mapRes').value = String(ui.mapRes);
      if (ui.mapMode) setMapMode(ui.mapMode === 'all' || ui.mapMode === 'stand' ? ui.mapMode : 'single');
      if (ui.mapColor) setMapColor(ui.mapColor === 'mode' ? 'mode' : 're');
      if (ui.mapFamily) setMapFamily(ui.mapFamily);
      if (ui.density) applyDensity(ui.density);
    }
    return notes;
  }
  let setScale = () => {}, setOverlay = () => {};
  (function bindJson() {
    const dlg = $('#jsonDlg'), ta = $('#jsonText'), st = $('#jsonStatus');
    const status = (msg, cls) => { st.textContent = msg; st.className = 'fine ' + (cls || ''); };
    $('#btnJson').addEventListener('click', () => { status('', ''); if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); });
    $('#jsonExport').addEventListener('click', () => { ta.value = JSON.stringify(exportConditions(), null, 2); status(`書き出し: ${ta.value.length.toLocaleString()} 文字`, 'ok'); });
    $('#jsonCopy').addEventListener('click', async () => {
      if (!ta.value) ta.value = JSON.stringify(exportConditions(), null, 2);
      try { await navigator.clipboard.writeText(ta.value); status('クリップボードにコピーした', 'ok'); }
      catch (e) { ta.focus(); ta.select(); status('自動コピー不可。欄を全選択したので手動でコピーして', 'err'); }
    });
    $('#jsonDownload').addEventListener('click', async () => {
      if (!ta.value) ta.value = JSON.stringify(exportConditions(), null, 2);
      const filename = `chatter-lab-conditions-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`;
      // claude.ai viewer: the downloads capability (viewer confirms); elsewhere: a plain blob download
      let dl = null;
      try { if (window.claude && typeof window.claude.use === 'function') dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
      if (dl) {
        try { const r = await dl.save({ filename, data: ta.value }); status(r && r.status === 'saved' ? `${filename} を保存した` : '保存を受け付けた', 'ok'); }
        catch (e) {
          const code = e && e.code;
          status(code === 'declined' ? '保存をキャンセルした' : code === 'rate_limited' ? '保存の確認が開いたまま。少し待ってから再度' : `この表示では保存できない（${code || 'unavailable'}）。コピーを使って`, code === 'declined' ? '' : 'err');
        }
        return;
      }
      try {
        const blob = new Blob([ta.value], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
        status(`${filename} のダウンロードを開始`, 'ok');
      } catch (e) { status('ダウンロードできない環境。コピーを使って', 'err'); }
    });
    $('#jsonImport').addEventListener('click', () => {
      try {
        const obj = JSON.parse(ta.value);
        const notes = importConditions(obj);
        status(`読み込み完了（${nS()} スタンド）${notes.length ? ' · ' + notes.join(' / ') : ''}`, 'ok');
      } catch (e) { status(`読み込み失敗: ${e.message}`, 'err'); }
    });
    $('#jsonFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { ta.value = String(rd.result || ''); try { const notes = importConditions(JSON.parse(ta.value)); status(`${f.name} を読み込んだ（${nS()} スタンド）${notes.length ? ' · ' + notes.join(' / ') : ''}`, 'ok'); } catch (err) { status(`読み込み失敗: ${err.message}`, 'err'); } };
      rd.onerror = () => status('ファイルを読めない', 'err');
      rd.readAsText(f);
      e.target.value = '';
    });
  })();
  $('#btnParams').addEventListener('click', () => toggleDrawer());
  $('#btnHelpAll').addEventListener('click', () => {
    aside.classList.toggle('show-help');
    try { localStorage.setItem('chatterlab.help', aside.classList.contains('show-help') ? '1' : '0'); } catch (e) { /* ignore */ }
    syncHelpToggle();
  });
  try { if (localStorage.getItem('chatterlab.help') === '1') aside.classList.add('show-help'); } catch (e) { /* ignore */ }
  $('#btnParamsClose').addEventListener('click', () => toggleDrawer(false));
  backdrop.addEventListener('click', () => toggleDrawer(false));

  function redrawStatic() {
    if (!S.line) return;
    structDirty = true; markDirty(true);
  }
  window.addEventListener('resize', () => { if (S.tab === 'overview') drawModeBands(); if (S.tab === 'stability') drawHeatmap(); });

  /** global computation stop: simulation, critical-speed search and stability maps (worker paused, resumes where it left off) */
  function setHalted(h) {
    S.halted = !!h;
    if (worker) worker.postMessage({ pause: S.halted });
    const b = $('#btnHalt');
    b.textContent = S.halted ? '計算再開' : '計算停止';
    b.setAttribute('aria-pressed', S.halted ? 'true' : 'false');
    b.classList.toggle('halted', S.halted);
    document.documentElement.classList.toggle('is-halted', S.halted);
    updateMapProgress();
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (dirty) { dirty = false; rebuild(); }
    const dtWall = S.lastFrame ? Math.min(0.05, (ts - S.lastFrame) / 1000) : 0.016;
    S.lastFrame = ts;
    let steps = 0;
    if (S.running && !S.halted) {
      steps = Math.max(1, Math.round(S.timeScale * S.sim.fs * dtWall));
      const t0 = performance.now();
      const broke = S.sim.advance(steps);
      S.simMs = (S.simMs || 0) * 0.9 + (performance.now() - t0) * 0.1;
      if (broke) onBreak();
    }
    S.frameMs = (S.frameMs || dtWall * 1000) * 0.9 + dtWall * 1000 * 0.1;
    if (S.frame % 15 === 0) {
      const dt = S.sim.dt;
      $('#cyclePill').textContent = `Δt ${(dt * 1e6).toFixed(0)} µs（${(S.sim.fs / 1000).toFixed(0)} kHz）｜ 描画 ${S.frameMs.toFixed(1)} ms（${(1000 / S.frameMs).toFixed(0)} fps）｜ ${steps} step/f · 計算 ${(S.simMs || 0).toFixed(1)} ms ｜ ×${S.timeScale} ｜ FFT ${(SPG.hop * 1000).toFixed(0)} ms`;
    }
    animateSchematic();
    spectrogramStep();
    if (S.tab === 'live') drawLive();
    if (S.tab === 'modal') drawStackFrame((ts - S.modeAnimT0) / 1000);
    critStep();
    if (S.mapJob && !S.halted) mapStep(S.tab === 'stability' ? 10 : 4);
    flushMapDraw();
    if (S.frame % 10 === 0) updateCardRms();
    S.frame++;
  }

  /* ================================================================
   * draggable borders: sidebar width, two-column splits, chart heights
   * (double-click a border to restore its default; saved per browser)
   * ================================================================ */
  (function bindLayoutGutters() {
    const KEY = 'chatterlab.layout';
    let L = {};
    try { L = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { L = {}; }
    if (typeof L !== 'object' || Array.isArray(L)) L = {};
    L.cols = L.cols && typeof L.cols === 'object' ? L.cols : {};
    L.h = L.h && typeof L.h === 'object' ? L.h : {};
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) { /* ignore */ } };
    const root = document.documentElement;
    let redrawQueued = false;
    const redraw = () => {
      if (redrawQueued) return;
      redrawQueued = true;
      requestAnimationFrame(() => { redrawQueued = false; window.dispatchEvent(new Event('resize')); });
    };
    const TITLE = 'ドラッグで調整（ダブルクリックで元に戻す）';
    /** pointer drag with capture; handlers get the pointer event */
    function drag(el, axis, { start, move, reset }) {
      el.title = TITLE;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('drag'); root.classList.add(axis === 'x' ? 'drag-col' : 'drag-row');
        start(e);
        const mv = ev => { move(ev); redraw(); };
        const up = () => {
          el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
          el.classList.remove('drag'); root.classList.remove('drag-col', 'drag-row');
          save(); redraw();
        };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      });
      el.addEventListener('dblclick', () => { reset(); save(); redraw(); });
    }

    // ---- sidebar | main
    const side = h('div', { class: 'gutter gutter-v gutter-side', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'パラメータ欄の幅' });
    $('.shell').append(side);
    const setSide = px => { if (px) root.style.setProperty('--side-w', px + 'px'); else root.style.removeProperty('--side-w'); };
    if (Number.isFinite(L.side)) setSide(clamp(L.side, 200, 700));
    drag(side, 'x', {
      start() {},
      move(e) { L.side = Math.round(clamp(e.clientX, 200, Math.max(220, Math.min(700, window.innerWidth - 420)))); setSide(L.side); },
      reset() { delete L.side; setSide(null); },
    });

    // ---- two-column grids
    const grids = [['ov', '.grid-2'], ['modal', '.grid-modal'], ['live', '.grid-live']];
    const colGutters = [];
    for (const [key, sel] of grids) {
      const grid = $(sel); if (!grid) continue;
      const g = h('div', { class: 'gutter gutter-v', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': '左右の幅' });
      grid.append(g);
      const setF = f => {
        if (f == null) { grid.style.removeProperty('--c1'); grid.style.removeProperty('--c2'); return; }
        grid.style.setProperty('--c1', f.toFixed(4) + 'fr'); grid.style.setProperty('--c2', (1 - f).toFixed(4) + 'fr');
      };
      if (Number.isFinite(L.cols[key])) setF(clamp(L.cols[key], 0.15, 0.85));
      const place = () => {
        const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);
        const items = [...grid.children].filter(el => el !== g && !el.hidden && !el.classList.contains('span2') && !el.classList.contains('gutter'));
        if (cols.length < 2 || !items.length || !grid.offsetParent) { g.hidden = true; return; }
        const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
        const t = Math.min(...items.map(el => el.offsetTop)), b = Math.max(...items.map(el => el.offsetTop + el.offsetHeight));
        g.hidden = false;
        g.style.left = (parseFloat(cols[0]) + gap / 2 - 5) + 'px';
        g.style.top = t + 'px'; g.style.height = Math.max(0, b - t) + 'px';
      };
      colGutters.push(place);
      drag(g, 'x', {
        start() {},
        move(e) {
          const r = grid.getBoundingClientRect(), gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
          L.cols[key] = +clamp((e.clientX - r.left - gap / 2) / Math.max(1, r.width - gap), 0.15, 0.85).toFixed(4);
          setF(L.cols[key]); place();
        },
        reset() { delete L.cols[key]; setF(null); place(); },
      });
      if (window.ResizeObserver) new ResizeObserver(place).observe(grid);
    }
    const placeCols = () => colGutters.forEach(f => f());
    window.addEventListener('resize', placeCols);

    // ---- chart heights (gutter just below the chart)
    const byId = (...ids) => () => ids.map(id => $('#' + id)).filter(Boolean);
    const H = [
      { key: 'bands', anchor: '#modeBands', els: byId('modeBands') },
      { key: 'scope', anchor: '#scopeGauge', up: '.tri', els: byId('scopeGauge', 'scopeTension', 'scopeForce') },
      { key: 'wf', anchor: '#wfGrid', host: '#wfCard', cssVar: '--ch-wf', probe: '#wfGrid .wf-canvas' },
      { key: 'spec', anchor: '#spectrum', els: byId('spectrum') },
      { key: 'vib', anchor: '#scopeVib', els: byId('scopeVib') },
      { key: 'wrx', anchor: '#scopeWrx', els: byId('scopeWrx') },
      { key: 'tq', anchor: '#scopeTq', els: byId('scopeTq') },
      { key: 'map', anchor: '#heatmap', els: byId('heatmap') },
      { key: 'cells', anchor: '#mapMulti', host: '#mapMulti', cssVar: '--cell-h', probe: '#mapMulti .chart' },
    ];
    for (const t of H) {
      let a = $(t.anchor); if (!a) continue;
      if (t.up) a = a.closest(t.up) || a;
      const g = h('div', { class: 'gutter gutter-h', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': '高さ' });
      a.after(g);
      const apply = px => {
        if (t.cssVar) { const host = $(t.host); if (px) host.style.setProperty(t.cssVar, px + 'px'); else host.style.removeProperty(t.cssVar); }
        else t.els().forEach(el => { el.style.height = px ? px + 'px' : ''; });
      };
      const measure = () => {
        const el = t.cssVar ? $(t.probe) : t.els()[0];
        return el ? el.getBoundingClientRect().height : 200;
      };
      if (Number.isFinite(L.h[t.key])) apply(clamp(L.h[t.key], 80, 1600));
      let y0 = 0, h0 = 0;
      drag(g, 'y', {
        start(e) { y0 = e.clientY; h0 = measure(); },
        move(e) { L.h[t.key] = Math.round(clamp(h0 + e.clientY - y0, 80, 1600)); apply(L.h[t.key]); },
        reset() { delete L.h[t.key]; apply(null); },
      });
    }
  })();

  try { const s0 = localStorage.getItem('chatterlab.spgSrc'); if (s0 && SPG_SRC[s0]) SPG.src = s0; } catch (e) { /* ignore */ }
  $$('.density button').forEach(b => b.addEventListener('click', () => applyDensity(b.dataset.density)));
  let savedDensity = 'compact';
  try { savedDensity = localStorage.getItem('chatterlab.density') || 'compact'; } catch (e) { /* ignore */ }
  applyDensity(savedDensity, true);
  buildParams();
  bindLiveControls();
  rebuild(); dirty = false;
  let savedTab = 'overview';
  try { savedTab = localStorage.getItem('chatterlab.tab') || 'overview'; } catch (e) { /* ignore */ }
  setTab(savedTab);
  requestAnimationFrame(frame);
  window.__lab = { S, P, SPG, spectrogramStep, drawLive, markDirty };   // debug hook
})();
