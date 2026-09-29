(() => {
  'use strict';

  // ---------- chart geometry (SVG viewBox units) ----------
  const VB_W = 800, VB_H = 420;
  const M = { top: 24, right: 16, bottom: 56, left: 52 };
  const PW = VB_W - M.left - M.right;   // plot width
  const PH = VB_H - M.top - M.bottom;   // plot height
  const BASE_Y = M.top + PH;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const svg = $('chart');
  const nRange = $('n-range'), nOut = $('n-out');
  const speedSel = $('speed');
  const playBtn = $('play');
  const showNormal = $('show-normal');
  const tooltip = $('tooltip');
  const countEl = $('count'), xbarEl = $('xbar'), sdEl = $('sd');
  const muEl = $('mu'), sigmaEl = $('sigma');
  const lastSumEl = $('last-sum'), diceEl = $('dice');

  // ---------- state ----------
  let N = 2;
  let counts = [];        // counts[k - N] = number of rolls with sum k
  let shown = [];         // animated displayed proportions per bin
  let total = 0, sum = 0, sumSq = 0;
  let lastSum = null, lastDice = [];
  let playing = false;
  let acc = 0, lastT = null;
  let yMaxShown = 0;
  let hoverBin = -1;
  let dirtyText = true;

  // SVG layers
  let gGrid, gBars, gHits, pathNormal, gXAxis;
  let bars = [];

  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  const mu = () => 3.5 * N;
  const sigma = () => Math.sqrt(35 * N / 12);
  const bins = () => 5 * N + 1;
  const binW = () => PW / bins();
  // x position (viewBox) of a sum value's bin center
  const xOf = (s) => M.left + (s - N + 0.5) * binW();

  function normalPdf(x) {
    const s = sigma();
    const z = (x - mu()) / s;
    return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
  }

  // ---------- setup / reset ----------
  function reset() {
    counts = new Array(bins()).fill(0);
    shown = new Array(bins()).fill(0);
    total = 0; sum = 0; sumSq = 0;
    lastSum = null; lastDice = [];
    yMaxShown = targetYMax();
    hoverBin = -1;
    tooltip.hidden = true;
    buildChart();
    dirtyText = true;
    renderText();
  }

  function buildChart() {
    svg.textContent = '';
    gGrid = el('g', { class: 'grid' }, svg);
    gBars = el('g', {}, svg);
    pathNormal = el('path', { class: 'normal' }, svg);
    el('line', { class: 'baseline', x1: M.left, x2: M.left + PW, y1: BASE_Y, y2: BASE_Y }, svg);
    gXAxis = el('g', {}, svg);
    gHits = el('g', {}, svg);

    const bw = binW();
    const gap = Math.min(2, bw * 0.15);
    bars = [];
    for (let i = 0; i < bins(); i++) {
      const p = el('path', { class: 'bar' }, gBars);
      p._x = M.left + i * bw + gap / 2;
      p._w = Math.max(0.5, bw - gap);
      bars.push(p);
      const h = el('rect', {
        class: 'hitbox', x: M.left + i * bw, y: M.top, width: bw, height: PH + 8,
      }, gHits);
      h.addEventListener('pointerenter', () => { hoverBin = i; updateTooltip(); });
      h.addEventListener('pointerleave', () => { if (hoverBin === i) { hoverBin = -1; updateTooltip(); } });
    }

    // x-axis: only min (N), mean (3.5N) and max (6N)
    const ticks = [
      { v: N, label: String(N), cap: 'min = N' },
      { v: mu(), label: fmtNum(mu()), cap: 'mean = 3.5N' },
      { v: 6 * N, label: String(6 * N), cap: 'max = 6N' },
    ];
    // mean guide line
    el('line', { class: 'mean-line', x1: xOf(mu()), x2: xOf(mu()), y1: M.top, y2: BASE_Y }, gXAxis);
    for (const t of ticks) {
      const g = el('g', { class: 'xtick', transform: `translate(${xOf(t.v)},${BASE_Y})` }, gXAxis);
      el('line', { y1: 0, y2: 6 }, g);
      const a = el('text', { y: 24, 'text-anchor': 'middle' }, g); a.textContent = t.label;
      const b = el('text', { y: 40, 'text-anchor': 'middle', class: 'cap' }, g); b.textContent = t.cap;
    }

    drawNormal();
  }

  function drawNormal() {
    if (!showNormal.checked) { pathNormal.setAttribute('d', ''); return; }
    const x0 = N - 0.5, x1 = 6 * N + 0.5;
    const steps = 240;
    let d = '';
    for (let j = 0; j <= steps; j++) {
      const s = x0 + (x1 - x0) * j / steps;
      const x = M.left + (s - x0) * binW();
      const y = yScale(normalPdf(s));
      d += (j ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2);
    }
    pathNormal.setAttribute('d', d);
  }

  // ---------- scales ----------
  function targetYMax() {
    let m = 0;
    if (total > 0) for (const c of counts) m = Math.max(m, c / total);
    if (showNormal.checked || total === 0) m = Math.max(m, normalPdf(mu()));
    return m * 1.12;
  }
  const yScale = (p) => BASE_Y - (p / yMaxShown) * PH;

  function niceStep(max) {
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    const m = f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10;
    return m * mag;
  }

  function drawGrid() {
    gGrid.textContent = '';
    const step = niceStep(yMaxShown);
    for (let v = step; v <= yMaxShown * 1.0001; v += step) {
      const y = yScale(v);
      el('line', { x1: M.left, x2: M.left + PW, y1: y, y2: y }, gGrid);
      const t = el('text', { x: M.left - 8, y: y + 4, 'text-anchor': 'end' }, gGrid);
      t.textContent = fmtPct(v, step);
    }
  }

  function barPath(x, w, h) {
    if (h < 0.25) return '';
    const y = BASE_Y - h;
    const r = Math.min(4, w / 2, h);
    return `M${x},${BASE_Y}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${BASE_Y}Z`;
  }

  // ---------- dice ----------
  const rollDie = () => 1 + Math.floor(Math.random() * 6);

  function rollOnce(keepDice) {
    let s = 0;
    if (keepDice) lastDice = [];
    for (let i = 0; i < N; i++) {
      const d = rollDie();
      s += d;
      if (keepDice) lastDice.push(d);
    }
    counts[s - N]++;
    total++; sum += s; sumSq += s * s;
    lastSum = s;
    dirtyText = true;
  }

  function roll(n) {
    for (let i = 0; i < n; i++) rollOnce(i === n - 1);
  }

  const PIPS = {
    1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [3, 1], [1, 3], [3, 3]], 5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
    6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
  };
  function renderDice() {
    diceEl.textContent = '';
    for (const d of lastDice) {
      const s = el('svg', { viewBox: '0 0 20 20' }, diceEl);
      el('rect', { x: 1, y: 1, width: 18, height: 18, rx: 4 }, s);
      for (const [cx, cy] of PIPS[d]) el('circle', { cx: cx * 5, cy: cy * 5, r: 1.8 }, s);
    }
  }

  // ---------- text ----------
  const fmtInt = (n) => n.toLocaleString();
  function fmtNum(v, digits = 2) {
    return Number.isInteger(v) ? String(v) : v.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  }
  function fmtPct(p, step) {
    const pct = p * 100;
    const stepPct = step * 100;
    const dec = stepPct >= 1 ? (Number.isInteger(stepPct) ? 0 : 1) : Math.min(3, Math.ceil(-Math.log10(stepPct)) + 1);
    return pct.toFixed(dec) + '%';
  }

  function renderText() {
    if (!dirtyText) return;
    dirtyText = false;
    countEl.textContent = fmtInt(total);
    muEl.textContent = fmtNum(mu());
    sigmaEl.textContent = sigma().toFixed(3);
    if (total > 0) {
      const mean = sum / total;
      xbarEl.textContent = mean.toFixed(3);
      if (total > 1) {
        const v = (sumSq - total * mean * mean) / (total - 1);
        sdEl.textContent = Math.sqrt(Math.max(0, v)).toFixed(3);
      } else sdEl.textContent = '—';
      lastSumEl.textContent = String(lastSum);
    } else {
      xbarEl.textContent = '—'; sdEl.textContent = '—'; lastSumEl.textContent = '—';
    }
    renderDice();
    updateTooltip();
  }

  function updateTooltip() {
    if (hoverBin < 0) { tooltip.hidden = true; bars.forEach((b) => b.classList.remove('hover')); return; }
    const i = hoverBin, s = N + i, c = counts[i];
    const p = total ? c / total : 0;
    bars.forEach((b, j) => b.classList.toggle('hover', j === i));
    tooltip.innerHTML =
      `<strong>Sum = ${s}</strong><br>` +
      `${fmtInt(c)} of ${fmtInt(total)} rolls<br>` +
      `Observed: ${(p * 100).toFixed(2)}%<br>` +
      `<span class="muted">Normal model: ${(normalPdf(s) * 100).toFixed(2)}%</span>`;
    const rect = svg.getBoundingClientRect();
    const k = rect.width / VB_W;
    const h = Math.max(shown[i], 0);
    const topY = Math.min(yScale(h), BASE_Y - 4);
    let left = xOf(s) * k;
    left = Math.max(80, Math.min(rect.width - 80, left));
    tooltip.style.left = left + 'px';
    tooltip.style.top = Math.max(topY * k, 60) + 'px';
    tooltip.hidden = false;
  }

  // ---------- animation loop ----------
  function frame(t) {
    const dt = lastT === null ? 0 : Math.min(0.1, (t - lastT) / 1000);
    lastT = t;

    if (demo) stepDemo(dt);

    if (playing) {
      acc += Number(speedSel.value) * dt;
      const n = Math.min(20000, Math.floor(acc));
      acc -= n;
      if (n > 0) roll(n);
    }

    // ease displayed values toward targets
    const ease = 1 - Math.pow(0.001, dt || 0.016);   // frame-rate independent
    const target = targetYMax();
    yMaxShown += (target - yMaxShown) * ease;

    let moving = Math.abs(target - yMaxShown) > target * 0.001;
    for (let i = 0; i < counts.length; i++) {
      const p = total ? counts[i] / total : 0;
      shown[i] += (p - shown[i]) * ease;
      if (Math.abs(p - shown[i]) > 1e-5) moving = true;
      const h = (shown[i] / yMaxShown) * PH;
      bars[i].setAttribute('d', barPath(bars[i]._x, bars[i]._w, Math.max(0, h)));
      bars[i].classList.toggle('hit', lastSum !== null && i === lastSum - N);
    }
    drawGrid();
    drawNormal();
    renderText();
    if (hoverBin >= 0 && moving) updateTooltip();

    requestAnimationFrame(frame);
  }

  // ---------- controls ----------
  function setN(n) {
    n = Math.max(1, Math.min(30, n));
    N = n;
    nRange.value = n;
    nOut.textContent = n;
    $('chart-title').textContent = `Distribution of the sum of ${n} ${n === 1 ? 'die' : 'dice'}`;
    reset();
  }

  function setPlaying(p) {
    playing = p;
    acc = 0;
    playBtn.textContent = p ? '❚❚ Pause' : '▶ Start rolling';
    playBtn.setAttribute('aria-pressed', String(p));
  }

  // ---------- animate demo: turbo-roll N = 1, 2, … for DEMO_ROLL s, hold DEMO_HOLD s, repeat ----------
  const DEMO_ROLL = 5, DEMO_HOLD = 5, DEMO_MAX_N = 10, DEMO_SPEED = '5000';
  const animateBtn = $('animate');
  const demoStatus = $('demo-status');
  let demo = null;   // { phase: 'roll' | 'hold', left: seconds remaining in phase }

  function startDemo() {
    speedSel.value = DEMO_SPEED;
    setN(1);
    demo = { phase: 'roll', left: DEMO_ROLL, shownSec: -1 };
    setPlaying(true);
    animateBtn.textContent = '■ Stop animation';
    animateBtn.classList.add('active');
    animateBtn.setAttribute('aria-pressed', 'true');
    demoStatus.hidden = false;
    renderDemoStatus();
  }

  function stopDemo() {
    if (!demo) return;
    demo = null;
    setPlaying(false);
    animateBtn.textContent = '✦ Animate';
    animateBtn.classList.remove('active');
    animateBtn.setAttribute('aria-pressed', 'false');
    demoStatus.hidden = true;
  }

  function stepDemo(dt) {
    demo.left -= dt;
    if (demo.left <= 0) {
      if (demo.phase === 'roll') {
        setPlaying(false);
        demo.phase = 'hold';
        demo.left = DEMO_HOLD;
      } else {
        setN(N >= DEMO_MAX_N ? 1 : N + 1);
        demo.phase = 'roll';
        demo.left = DEMO_ROLL;
        setPlaying(true);
      }
    }
    renderDemoStatus();
  }

  function renderDemoStatus() {
    const sec = Math.max(1, Math.ceil(demo.left));
    if (sec === demo.shownSec && demo.phase === demo.shownPhase) return;
    demo.shownSec = sec;
    demo.shownPhase = demo.phase;
    const what = demo.phase === 'roll' ? 'Rolling' : 'Pausing';
    const next = demo.phase === 'hold' ? ` — next: N = ${N >= DEMO_MAX_N ? 1 : N + 1}` : '';
    demoStatus.innerHTML = `Animating N = 1 → ${DEMO_MAX_N} · <strong>N = ${N}</strong> · ${what} ${sec}s${next}`;
  }

  // any manual control takes over from the demo
  const manual = (fn) => () => { stopDemo(); fn(); };

  animateBtn.addEventListener('click', () => (demo ? stopDemo() : startDemo()));
  nRange.addEventListener('input', manual(() => setN(Number(nRange.value))));
  $('n-minus').addEventListener('click', manual(() => setN(N - 1)));
  $('n-plus').addEventListener('click', manual(() => setN(N + 1)));
  playBtn.addEventListener('click', () => { const was = playing; stopDemo(); setPlaying(!was); });
  speedSel.addEventListener('change', () => stopDemo());
  $('roll1').addEventListener('click', manual(() => roll(1)));
  $('roll100').addEventListener('click', manual(() => roll(100)));
  $('reset').addEventListener('click', manual(() => reset()));
  showNormal.addEventListener('change', () => {
    $('legend-normal').classList.toggle('off', !showNormal.checked);
    drawNormal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, button')) return;
    if (e.code === 'Space') { e.preventDefault(); const was = playing; stopDemo(); setPlaying(!was); }
    else if (e.key === 'r') { stopDemo(); roll(1); }
  });

  setN(N);
  requestAnimationFrame(frame);
})();
