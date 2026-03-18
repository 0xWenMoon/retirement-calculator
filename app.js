// ─── Chart instances ─────────────────────────────────────────────────────────
let chartInstances = {};

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  currentStep: 1,
  totalSteps: 3,
  inputs: {
    currentAge: 30,
    netWorth: 0,
    currentSpend: 5000,
    peakSpend: 10000,
    isEarning: false,
    annualIncome: 0,
    earningYears: 0,
    growthRate: 0.07,
    withdrawalRate: 0.035,
    modelToAge: 90,
  },
  results: null,
};

// ─── Spending Curve ───────────────────────────────────────────────────────────

function monthlySpend(age, cs, ps) {
  if (age < 25) return cs;
  if (age <= 35) return cs + ((ps - cs) * (age - 25)) / 10;
  if (age <= 50) return ps;
  if (age <= 65) return ps + ((cs * 1.4 - ps) * (age - 50)) / 15;
  if (age <= 75) return cs * 1.4 + ((cs * 1.2 - cs * 1.4) * (age - 65)) / 10;
  // 75–90
  const base = cs * 1.2;
  const rise = (ps * 0.2 * (age - 75)) / 15;
  return base + rise;
}

function annualSpend(age, cs, ps) {
  return monthlySpend(age, cs, ps) * 12;
}

// ─── Core Model ───────────────────────────────────────────────────────────────

/**
 * Simulate from currentAge to modelToAge with a given starting nest egg.
 * Returns { survived, breached, minRatio, portfolioByAge, floorByAge, rateByAge }
 */
function simulate(startNestEgg, inputs) {
  const { currentAge, currentSpend, peakSpend, isEarning, annualIncome,
          earningYears, growthRate, withdrawalRate, modelToAge } = inputs;

  const cs = currentSpend;
  const ps = peakSpend;
  const retireAge = isEarning ? currentAge + earningYears : currentAge;

  let portfolio = startNestEgg;
  const portfolioByAge = [];
  const floorByAge = [];
  const rateByAge = [];
  let survived = true;
  let breached = false;

  for (let age = currentAge; age <= modelToAge; age++) {
    const spend = annualSpend(age, cs, ps);
    const netWithdrawal = age < retireAge ? Math.max(0, spend - annualIncome) : spend;
    const floor = netWithdrawal / withdrawalRate;

    // Accumulation phase
    if (age < retireAge) {
      portfolio = portfolio * (1 + growthRate) + (annualIncome - spend);
    } else {
      portfolio = portfolio * (1 + growthRate) - spend;
    }

    const rate = portfolio > 0 ? netWithdrawal / portfolio : (netWithdrawal > 0 ? Infinity : 0);

    portfolioByAge.push({ age, value: portfolio });
    floorByAge.push({ age, value: floor });
    rateByAge.push({ age, rate });

    if (portfolio <= 0) { survived = false; break; }
    if (rate > withdrawalRate + 0.0001) breached = true;
  }

  return { survived, breached, portfolioByAge, floorByAge, rateByAge };
}

/**
 * Binary search for minimum starting nest egg where portfolio survives AND
 * withdrawal rate never exceeds the cap at any year.
 */
function findMinNestEgg(inputs) {
  let lo = 0;
  let hi = 50_000_000;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const { survived, breached } = simulate(mid, inputs);
    if (survived && !breached) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return Math.ceil(hi / 1000) * 1000;
}

// ─── Suggestion helpers ───────────────────────────────────────────────────────

/**
 * Can the portfolio reach a self-sustaining FIRE point within maxYears of earning?
 */
function canReachFireWithin(inp, maxYears) {
  let p = inp.netWorth;
  for (let y = 1; y <= maxYears; y++) {
    const age = inp.currentAge + y;
    const spend = annualSpend(age, inp.currentSpend, inp.peakSpend);
    p = p * (1 + inp.growthRate) + (inp.annualIncome - spend);
    if (p <= 0) return false;
    const testMin = findMinNestEgg({ ...inp, currentAge: age, netWorth: p, isEarning: false, earningYears: 0 });
    if (p >= testMin) return true;
  }
  return false;
}

/**
 * Returns total years from now until FIRE (null if unreachable in 50y).
 * Extracted so computeSuggestions can reuse it with modified inputs.
 */
function findYearsToFire(inp) {
  let p = inp.netWorth;
  for (let y = 1; y <= 50; y++) {
    const age = inp.currentAge + y;
    const spend = annualSpend(age, inp.currentSpend, inp.peakSpend);
    p = p * (1 + inp.growthRate) + (inp.annualIncome - spend);
    if (p <= 0) return null;
    const testMin = findMinNestEgg({ ...inp, currentAge: age, netWorth: p, isEarning: false, earningYears: 0 });
    if (p >= testMin) return y;
  }
  return null;
}

/**
 * Compute the 3 levers that close the gap and identify the easiest one.
 * Only called once on initial showResults — not recomputed on assumption slider changes.
 */
function computeSuggestions(inp, yearsToFire) {
  const result = { extraYears: null, spendCut: null, incomeBoost: null, easiest: null };

  if (inp.isEarning && yearsToFire !== null && yearsToFire > inp.earningYears) {
    // ── Lever 1: extra years beyond plan ──
    result.extraYears = yearsToFire - inp.earningYears;

    // ── Lever 2: monthly spend cut to fit within earningYears ──
    const maxCut = inp.currentSpend * 0.7;
    const ratioAtMax = (inp.currentSpend - maxCut) / inp.currentSpend;
    if (canReachFireWithin({ ...inp, currentSpend: inp.currentSpend - maxCut, peakSpend: inp.peakSpend * ratioAtMax }, inp.earningYears)) {
      let lo = 0, hi = maxCut;
      for (let i = 0; i < 25; i++) {
        const mid = (lo + hi) / 2;
        const ratio = (inp.currentSpend - mid) / inp.currentSpend;
        if (canReachFireWithin({ ...inp, currentSpend: inp.currentSpend - mid, peakSpend: inp.peakSpend * ratio }, inp.earningYears)) hi = mid;
        else lo = mid;
      }
      if (hi / inp.currentSpend <= 0.4) result.spendCut = Math.ceil(hi / 10) * 10;
    }

    // ── Lever 3: annual income boost to fit within earningYears ──
    const maxBoost = Math.max(inp.annualIncome * 2, 300000);
    if (canReachFireWithin({ ...inp, annualIncome: inp.annualIncome + maxBoost }, inp.earningYears)) {
      let lo = 0, hi = maxBoost;
      for (let i = 0; i < 25; i++) {
        const mid = (lo + hi) / 2;
        if (canReachFireWithin({ ...inp, annualIncome: inp.annualIncome + mid }, inp.earningYears)) hi = mid;
        else lo = mid;
      }
      const base = inp.annualIncome || 80000;
      if (hi / base <= 1.0) result.incomeBoost = Math.ceil(hi / 1000) * 1000;
    }

  }

  // ── Easiest lever: lowest relative effort ──
  const scores = {};
  if (result.extraYears != null) scores.years = result.extraYears / 5;
  if (result.spendCut  != null) scores.spend  = (result.spendCut / inp.currentSpend) / 0.3;
  if (result.incomeBoost != null) scores.income = (result.incomeBoost / (inp.annualIncome || 80000)) / 0.5;
  const sorted = Object.entries(scores).sort((a, b) => a[1] - b[1]);
  result.easiest = sorted[0]?.[0] ?? null;

  return result;
}

// ─── Results computation ──────────────────────────────────────────────────────

function computeResults(skipSuggestions = false) {
  const inp = state.inputs;
  const minNestEgg = findMinNestEgg(inp);
  const sim = simulate(inp.netWorth, inp);
  const minSim = simulate(minNestEgg, inp);
  const peakFloor = Math.max(...minSim.floorByAge.map(d => d.value));
  const gap = minNestEgg - inp.netWorth;
  const canRetireNow = gap <= 0;
  const gapPct = minNestEgg > 0 ? gap / minNestEgg : 0;

  // Projected net worth at end of earning period (for metrics display)
  let projectedAtRetire = null;
  if (inp.isEarning && inp.earningYears > 0) {
    let p = inp.netWorth;
    for (let y = 0; y < inp.earningYears; y++) {
      const age = inp.currentAge + y;
      const spend = annualSpend(age, inp.currentSpend, inp.peakSpend);
      p = p * (1 + inp.growthRate) + (inp.annualIncome - spend);
    }
    projectedAtRetire = p;
  }

  // Years until FIRE is achievable
  const yearsToFire = (!canRetireNow && inp.isEarning) ? findYearsToFire(inp) : null;
  const extraYearsNeeded = (yearsToFire !== null && inp.isEarning) ? Math.max(0, yearsToFire - inp.earningYears) : null;

  // 4-state verdict
  let verdict;
  if (canRetireNow) {
    verdict = 'green';
  } else if (inp.isEarning && yearsToFire !== null && yearsToFire <= inp.earningYears) {
    verdict = 'amber-good';
  } else if (inp.isEarning && yearsToFire !== null) {
    verdict = 'amber-warn';
  } else {
    verdict = 'red';
  }

  // Suggestions only make sense for earning users who are behind their plan.
  // Non-earning users can see their gap in the metrics — no levers to compute.
  const needsSuggestions = verdict === 'amber-warn';
  const suggestions = skipSuggestions
    ? (state.results?.suggestions ?? null)
    : needsSuggestions ? computeSuggestions(inp, yearsToFire) : null;

  // Withdrawal tier — computed from max rate during retirement phase of simulation
  const retireAge = inp.isEarning ? inp.currentAge + inp.earningYears : inp.currentAge;
  const retirementRates = sim.rateByAge.filter(d => d.age >= retireAge && isFinite(d.rate) && d.rate > 0);
  const maxWithdrawalRate = retirementRates.length > 0 ? Math.max(...retirementRates.map(d => d.rate)) : 0;
  const withdrawalTier = maxWithdrawalRate <= 0.03  ? 'super-safe'
    : maxWithdrawalRate <= 0.035 ? 'safe-barely'
    : maxWithdrawalRate <= 0.04  ? 'hairy'
    : 'unsafe';

  return {
    minNestEgg, gap, gapPct, peakFloor, projectedAtRetire,
    canRetireNow, verdict, yearsToFire, extraYearsNeeded,
    maxWithdrawalRate, withdrawalTier,
    suggestions, sim, minSim,
    inputs: { ...inp },
  };
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function fmt(n, decimals = 0) {
  if (!isFinite(n) || isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(decimals)}`;
}

function fmtPct(n) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

function parseMoneyInput(val) {
  return parseFloat(val.replace(/[^0-9.-]/g, '')) || 0;
}

// Attach to a money input: blocks non-numeric keys, formats with commas live
function attachMoneyInput(el) {
  el.addEventListener('keydown', (e) => {
    const allowed = ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Home','End'];
    if (allowed.includes(e.key)) return;
    if (e.key === '.' && !el.value.includes('.')) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });

  el.addEventListener('input', () => {
    const raw = el.value.replace(/[^0-9.]/g, '');
    const parts = raw.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const formatted = parts.slice(0, 2).join(raw.includes('.') ? '.' : '');
    // Preserve cursor offset from end
    const endOffset = el.value.length - el.selectionEnd;
    el.value = formatted;
    const newPos = Math.max(0, formatted.length - endOffset);
    el.setSelectionRange(newPos, newPos);
  });
}

// ─── Step Navigation ──────────────────────────────────────────────────────────

function goToStep(n) {
  state.currentStep = n;
  renderStep();
}

function nextStep() {
  if (state.currentStep < state.totalSteps) {
    collectInputs();
    goToStep(state.currentStep + 1);
  } else {
    collectInputs();
    showResults();
  }
}

function prevStep() {
  if (state.currentStep > 1) goToStep(state.currentStep - 1);
}

function collectInputs() {
  const s = state.currentStep;
  if (s === 1) {
    state.inputs.currentAge = parseInt(document.getElementById('currentAge').value) || 30;
    state.inputs.netWorth = parseMoneyInput(document.getElementById('netWorth').value);
    state.inputs.currentSpend = parseMoneyInput(document.getElementById('currentSpend').value);
  } else if (s === 2) {
    state.inputs.peakSpend = parseMoneyInput(document.getElementById('peakSpend').value);
  } else if (s === 3) {
    const earning = document.getElementById('isEarning').checked;
    state.inputs.isEarning = earning;
    if (earning) {
      state.inputs.annualIncome = parseMoneyInput(document.getElementById('annualIncome').value);
      state.inputs.earningYears = parseInt(document.getElementById('earningYears').value) || 0;
    }
  }
}

// ─── Render Steps ─────────────────────────────────────────────────────────────

function renderStep() {
  const container = document.getElementById('app');
  updateProgressBar();

  const stepRenderers = [null, renderStep1, renderStep2, renderStep3];
  const html = stepRenderers[state.currentStep]();

  document.getElementById('step-content').innerHTML = html;
  attachStepListeners();
}

function updateProgressBar() {
  const steps = document.querySelectorAll('.progress-step');
  steps.forEach((el, i) => {
    el.classList.remove('active', 'completed');
    if (i + 1 === state.currentStep) el.classList.add('active');
    if (i + 1 < state.currentStep) el.classList.add('completed');
  });
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${((state.currentStep - 1) / (state.totalSteps - 1)) * 100}%`;
}

function renderStep1() {
  const i = state.inputs;
  return `
    <div class="step-header">
      <div class="step-label">Step 1 of 3</div>
      <h2>You today</h2>
      <p class="step-desc">Tell us where you're starting from.</p>
    </div>
    <div class="form-group">
      <label>Current age</label>
      <div class="slider-row">
        <input type="range" id="currentAge" min="18" max="65" value="${i.currentAge}" oninput="document.getElementById('ageDisplay').textContent=this.value">
        <span class="slider-val" id="ageDisplay">${i.currentAge}</span>
      </div>
    </div>
    <div class="form-group">
      <label>Current investable net worth</label>
      <div class="input-prefix">
        <span>$</span>
        <input type="text" id="netWorth" class="money-input" value="${i.netWorth > 0 ? i.netWorth.toLocaleString() : ''}" placeholder="e.g. 250,000">
      </div>
    </div>
    <div class="form-group">
      <label>Current monthly spend</label>
      <div class="input-prefix">
        <span>$</span>
        <input type="text" id="currentSpend" class="money-input" value="${i.currentSpend > 0 ? i.currentSpend.toLocaleString() : ''}" placeholder="e.g. 5,000">
      </div>
    </div>
    ${stepButtons(false, true)}
  `;
}

function renderStep2() {
  const i = state.inputs;
  const suggested = i.currentSpend * 2;
  const displayVal = i.peakSpend !== suggested && i.peakSpend > 0 ? i.peakSpend : suggested;
  return `
    <div class="step-header">
      <div class="step-label">Step 2 of 3</div>
      <h2>Future spending</h2>
      <p class="step-desc">What's the peak you expect your spending to reach?</p>
    </div>
    <div class="form-group">
      <label>Expected peak monthly spend</label>
      <p class="field-hint">Think: family, mortgage, lifestyle peak — typically ages 35–50</p>
      <div class="input-prefix">
        <span>$</span>
        <input type="text" id="peakSpend" class="money-input" value="${displayVal.toLocaleString()}" placeholder="e.g. 10,000">
      </div>
      <p class="field-hint muted">Pre-filled at 2× your current spend (${fmt(suggested)}/mo)</p>
    </div>
    ${stepButtons(true, true)}
  `;
}

function renderStep3() {
  const i = state.inputs;
  return `
    <div class="step-header">
      <div class="step-label">Step 3 of 3</div>
      <h2>Income</h2>
      <p class="step-desc">Are you still in your earning years?</p>
    </div>
    <div class="form-group">
      <label>Still earning?</label>
      <div class="toggle-row">
        <label class="toggle">
          <input type="checkbox" id="isEarning" ${i.isEarning ? 'checked' : ''} onchange="toggleEarning(this.checked)">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
        <span id="earningLabel">${i.isEarning ? 'Yes' : 'No'}</span>
      </div>
    </div>
    <div id="earning-fields" style="display:${i.isEarning ? 'block' : 'none'}">
      <div class="form-group">
        <label>After-tax annual income</label>
        <div class="input-prefix">
          <span>$</span>
          <input type="text" id="annualIncome" class="money-input" value="${i.annualIncome > 0 ? i.annualIncome.toLocaleString() : ''}" placeholder="e.g. 150,000">
        </div>
      </div>
      <div class="form-group">
        <label>Years you expect to keep earning</label>
        <div class="slider-row">
          <input type="range" id="earningYears" min="1" max="40" value="${i.earningYears || 5}" oninput="document.getElementById('yearsDisplay').textContent=this.value">
          <span class="slider-val" id="yearsDisplay">${i.earningYears || 5}</span>
        </div>
      </div>
    </div>
    ${stepButtons(true, true, 'Calculate')}
  `;
}

function renderStep4() {
  const i = state.inputs;
  return `
    <div class="step-header">
      <div class="step-label">Step 4 of 4</div>
      <h2>Assumptions</h2>
      <p class="step-desc">Adjust if you want — sensible defaults are pre-filled.</p>
    </div>
    <div class="form-group">
      <label>Expected annual portfolio growth</label>
      <div class="slider-row">
        <input type="range" id="growthRate" min="2" max="15" step="0.5" value="${(i.growthRate * 100).toFixed(1)}" oninput="document.getElementById('growthDisplay').textContent=this.value+'%'">
        <span class="slider-val" id="growthDisplay">${(i.growthRate * 100).toFixed(1)}%</span>
      </div>
    </div>
    <div class="form-group">
      <label>Max withdrawal rate cap</label>
      <div class="slider-row">
        <input type="range" id="withdrawalRate" min="2" max="6" step="0.1" value="${(i.withdrawalRate * 100).toFixed(1)}" oninput="document.getElementById('wdDisplay').textContent=this.value+'%'">
        <span class="slider-val" id="wdDisplay">${(i.withdrawalRate * 100).toFixed(1)}%</span>
      </div>
    </div>
    <div class="form-group">
      <label>Model to age</label>
      <div class="slider-row">
        <input type="range" id="modelToAge" min="75" max="100" value="${i.modelToAge}" oninput="document.getElementById('ageToDisplay').textContent=this.value">
        <span class="slider-val" id="ageToDisplay">${i.modelToAge}</span>
      </div>
    </div>
    ${stepButtons(true, true, 'Calculate')}
  `;
}

function stepButtons(showBack, showNext, nextLabel = 'Continue') {
  return `
    <div class="step-buttons">
      ${showBack ? `<button class="btn-secondary" onclick="prevStep()">Back</button>` : `<div></div>`}
      ${showNext ? `<button class="btn-primary" onclick="nextStep()">${nextLabel}</button>` : ''}
    </div>
  `;
}

function attachStepListeners() {
  document.querySelectorAll('.money-input').forEach(attachMoneyInput);
}

function toggleEarning(val) {
  document.getElementById('earning-fields').style.display = val ? 'block' : 'none';
  document.getElementById('earningLabel').textContent = val ? 'Yes' : 'No';
}

// ─── Archetypes & Hero ────────────────────────────────────────────────────────

function getArchetype(r) {
  const inp = r.inputs;
  const spendRatio = inp.peakSpend / Math.max(inp.currentSpend, 1);
  const gapPct = r.gapPct;
  const isHighEarner = inp.annualIncome > 150000;
  const isLeanSpender = inp.currentSpend < 4000;
  const yr = n => `${n} year${n === 1 ? '' : 's'}`;

  if (r.verdict === 'green') {
    if (Math.abs(r.gap) > r.minNestEgg * 0.5) return {
      label: 'The Comfortable Retiree',
      desc: "You're done. Fully, comfortably, irreversibly done. Most people never get here.",
    };
    return {
      label: 'The Accidental FIRE',
      desc: "You hit the number without making it your whole personality. Quietly impressive.",
    };
  }

  if (gapPct < 0.12) return {
    label: 'The Almost There',
    desc: "Close enough to smell it. One or two smart moves and you're done. Don't get complacent now.",
  };

  if (spendRatio > 2.2 && gapPct > 0.2) return {
    label: 'The Lifestyle Inflator',
    desc: "Your future self plans to spend twice what your current self earns. Someone had to say it.",
  };

  if (r.verdict === 'amber-good') {
    const ahead = inp.earningYears - r.yearsToFire;
    if (ahead >= 3) return {
      label: 'The Overachiever',
      desc: `You'll hit FIRE ${yr(ahead)} before you planned. Either your math was wrong or you're doing something right.`,
    };
    return {
      label: 'The Steady Builder',
      desc: "Boring is underrated. You're going to make it and nobody will be surprised.",
    };
  }

  if (isHighEarner && gapPct > 0.5) return {
    label: 'The High Earner, Late Saver',
    desc: "High income. High spend. Low urgency — until now. The income was never the problem.",
  };

  if (isLeanSpender && gapPct < 0.5) return {
    label: 'The Lean FIRE Candidate',
    desc: "You live cheap and you know it. That's not a bug — it's the whole strategy.",
  };

  if (r.verdict === 'amber-warn') {
    const extra = r.extraYearsNeeded;
    if (extra <= 2) return {
      label: 'The Almost There',
      desc: `${yr(extra)} behind your plan. Annoying, not catastrophic. You know what to fix.`,
    };
    if (extra <= 5) return {
      label: 'The Grind It Out',
      desc: `${yr(extra)} behind your plan. The math doesn't care about your timeline. Adjust or accept.`,
    };
    return {
      label: 'The Long Game',
      desc: "You've got a long road ahead. That's fine. The people who make it rarely had it handed to them.",
    };
  }

  if (!inp.isEarning && gapPct > 0.5) return {
    label: 'The Dreamer',
    desc: "The intention is there. The portfolio isn't. These are solvable problems, but not on their own.",
  };

  return {
    label: 'The Work in Progress',
    desc: "Not where you need to be yet — but neither was everyone who made it. The question is what you do next.",
  };
}

function getRetireAge(r) {
  if (r.verdict === 'green') return r.inputs.currentAge;
  if (r.yearsToFire !== null) return r.inputs.currentAge + r.yearsToFire;
  return null;
}

function heroHTML(r) {
  const archetype = getArchetype(r);
  const retireAge = getRetireAge(r);

  let agePart;
  if (r.verdict === 'green') {
    agePart = `<div class="hero-age hero-age-now">Now.</div>`;
  } else if (retireAge !== null) {
    agePart = `<div class="hero-age">${retireAge}<span class="hero-age-unit">yrs</span></div>`;
  } else {
    agePart = `<div class="hero-age hero-age-none">No clear path.</div>`;
  }

  const retireLabel = r.verdict === 'green' ? 'You can retire' : 'Retire at';

  return `
    <div class="hero-section">
      <div class="archetype-badge">${archetype.label}</div>
      <div class="hero-retire-label">${retireLabel}</div>
      ${agePart}
      <div class="archetype-desc">"${archetype.desc}"</div>
    </div>`;
}

function shareCardHTML(r) {
  const archetype = getArchetype(r);
  const retireAge = getRetireAge(r);
  const progressPct = r.minNestEgg > 0
    ? Math.min(100, Math.max(0, Math.round((r.inputs.netWorth / r.minNestEgg) * 100)))
    : 0;

  const retireDisplay = r.verdict === 'green' ? 'Now' : (retireAge ?? '—');
  const retireUnit = r.verdict === 'green' ? '' : (retireAge ? ' yrs' : '');

  const tweetLines = [
    `FIRE check — ${archetype.label}`,
    ``,
    `Retire: ${r.verdict === 'green' ? 'Now' : retireAge ? `Age ${retireAge}` : 'TBD'}`,
    `FIRE number: ${fmt(r.minNestEgg)}`,
    `Progress: ${progressPct}% there`,
    ``,
    `What's yours? 👇`,
    `https://0xwenmoon.github.io/retirement-calculator/`,
    ``,
    `via @0xWenMoon`,
  ];
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetLines.join('\n'))}`;

  return `
    <div class="share-card">
      <div class="share-card-label">Your FIRE snapshot</div>
      <div class="share-stats-row">
        <div class="share-stat">
          <div class="share-stat-label">Retire at</div>
          <div class="share-stat-val">${retireDisplay}${retireUnit}</div>
        </div>
        <div class="share-stat-divider"></div>
        <div class="share-stat">
          <div class="share-stat-label">FIRE number</div>
          <div class="share-stat-val">${fmt(r.minNestEgg)}</div>
        </div>
        <div class="share-stat-divider"></div>
        <div class="share-stat">
          <div class="share-stat-label">Progress</div>
          <div class="share-stat-val">${progressPct}%</div>
        </div>
      </div>
      <div class="share-progress-wrap">
        <div class="share-progress-track">
          <div class="share-progress-fill" style="width:${progressPct}%"></div>
        </div>
        <span class="share-progress-label">${progressPct}% to FIRE</span>
      </div>
      <button class="share-btn" onclick="window.open('${shareUrl}', '_blank')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        Share your number
      </button>
    </div>`;
}

// ─── Results ──────────────────────────────────────────────────────────────────

function verdictHTML(r) {
  const s = r.suggestions;
  const inp = r.inputs;
  const yr = n => `${n} year${n === 1 ? '' : 's'}`;

  // Build easiest-lever subtitle snippet
  function easiestSnippet() {
    if (!s || !s.easiest) return '';
    if (s.easiest === 'years')  return `Quickest fix: work ${yr(s.extraYears)} longer than planned.`;
    if (s.easiest === 'spend')  return `Quickest fix: cut ${fmt(s.spendCut)}/mo from spending.`;
    if (s.easiest === 'income') return `Quickest fix: earn ${fmt(s.incomeBoost)} more per year.`;
    return '';
  }

  // Closeness qualifier for amber-warn / red
  function closenessPrefix() {
    if (r.gapPct < 0.1) return "You're almost there. ";
    if (r.gapPct < 0.25) return "You're getting close. ";
    return '';
  }

  const config = {
    green: {
      cls: 'verdict-green', icon: '✦',
      title: 'You can retire now.',
      subtitle: `Your net worth clears the minimum by ${fmt(Math.abs(r.gap))}. Your portfolio is on track to last to age ${inp.modelToAge}.`,
    },
    'amber-good': {
      cls: 'verdict-amber', icon: '◈',
      title: (() => {
        const ahead = inp.earningYears - r.yearsToFire;
        if (ahead >= 2) return `On track — you'll hit FIRE ${yr(ahead)} ahead of plan.`;
        if (ahead === 1) return `On track — you'll hit FIRE 1 year ahead of plan.`;
        return `Right on schedule.`;
      })(),
      subtitle: `Keep your current plan. Your projected portfolio at retirement clears the minimum by ${fmt(Math.max(0, r.projectedAtRetire - r.minNestEgg))}.`,
    },
    'amber-warn': {
      cls: 'verdict-amber', icon: '◈',
      title: (() => {
        const extra = r.extraYearsNeeded;
        if (s?.easiest === 'spend' && s.spendCut)  return `Cut ${fmt(s.spendCut)}/mo and you're on schedule.`;
        if (s?.easiest === 'income' && s.incomeBoost) return `Earn ${fmt(s.incomeBoost)} more per year and you're on schedule.`;
        return `${yr(extra)} more than you planned.`;
      })(),
      subtitle: (() => {
        const extra = r.extraYearsNeeded;
        const parts = [];
        if (s?.easiest !== 'years'   && s?.extraYears)   parts.push(`work ${yr(s.extraYears)} longer`);
        if (s?.easiest !== 'spend'   && s?.spendCut)     parts.push(`cut ${fmt(s.spendCut)}/mo`);
        if (s?.easiest !== 'income'  && s?.incomeBoost)  parts.push(`earn ${fmt(s.incomeBoost)} more/yr`);
        const snippet = easiestSnippet();
        const alts = parts.length ? ` Alternatives: ${parts.join(', or ')}.` : '';
        return `${closenessPrefix()}${snippet}${alts}`;
      })(),
    },
    red: {
      cls: 'verdict-red', icon: '⚠',
      title: `You need ${fmt(r.gap)} more.`,
      subtitle: (() => {
        if (s?.spendCut) return `${closenessPrefix()}Cut ${fmt(s.spendCut)}/mo and your current net worth covers the minimum nest egg. Or start earning to close the gap faster.`;
        return `${closenessPrefix()}Your spending level requires significant changes — reduce lifestyle costs or add income to get on track.`;
      })(),
    },
  };

  const v = config[r.verdict];
  return `
    <div class="verdict-banner ${v.cls}">
      <div class="verdict-icon">${v.icon}</div>
      <div>
        <div class="verdict-title">${v.title}</div>
        <div class="verdict-sub">${v.subtitle}</div>
      </div>
    </div>`;
}

function suggestionsHTML(r) {
  const s = r.suggestions;
  if (!s || (!s.extraYears && !s.spendCut && !s.incomeBoost)) return '';

  const yr = n => `${n} year${n === 1 ? '' : 's'}`;
  const inp = r.inputs;

  const levers = [];
  if (s.extraYears != null) levers.push({
    key: 'years',
    label: `Work ${yr(s.extraYears)} longer than planned`,
    detail: `Retire at ${inp.currentAge + inp.earningYears + s.extraYears} instead of ${inp.currentAge + inp.earningYears}`,
  });
  if (s.spendCut != null) levers.push({
    key: 'spend',
    label: `Cut ${fmt(s.spendCut)}/mo from current spending`,
    detail: `${fmt(inp.currentSpend)}/mo → ${fmt(inp.currentSpend - s.spendCut)}/mo (${Math.round(s.spendCut / inp.currentSpend * 100)}% reduction)`,
  });
  if (s.incomeBoost != null) levers.push({
    key: 'income',
    label: `Earn ${fmt(s.incomeBoost)} more per year`,
    detail: `${fmt(inp.annualIncome)}/yr → ${fmt(inp.annualIncome + s.incomeBoost)}/yr after-tax`,
  });

  const items = levers.map(l => {
    const isEasiest = l.key === s.easiest;
    return `
      <div class="lever-row ${isEasiest ? 'lever-easiest' : ''}">
        <div class="lever-dot ${isEasiest ? 'lever-dot-active' : ''}"></div>
        <div class="lever-body">
          <div class="lever-label">${l.label}${isEasiest ? '<span class="lever-badge">Easiest</span>' : ''}</div>
          <div class="lever-detail">${l.detail}</div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="suggestions-block">
      <div class="assumptions-title">What would close the gap?</div>
      ${items}
    </div>`;
}

function metricsHTML(r) {
  const tierMeta = {
    'super-safe':  { label: 'Super safe',               cls: 'metric-green', detail: 'Max withdrawal never exceeds 3%' },
    'safe-barely': { label: 'Safe, but barely',         cls: 'metric-amber', detail: `Peaks at ${fmtPct(r.maxWithdrawalRate)} — just above 3%` },
    'hairy':       { label: 'Could be hairy',           cls: 'metric-amber', detail: `Peaks at ${fmtPct(r.maxWithdrawalRate)} — above 3.5%` },
    'unsafe':      { label: "Can't retire comfortably", cls: 'metric-red',   detail: `Peaks at ${fmtPct(r.maxWithdrawalRate)} — above 4%` },
  };
  const tier = tierMeta[r.withdrawalTier];

  return `
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Minimum nest egg needed</div>
        <div class="metric-value">${fmt(r.minNestEgg)}</div>
      </div>
      <div class="metric-card ${r.gap > 0 ? 'metric-red' : 'metric-green'}">
        <div class="metric-label">${r.gap > 0 ? 'Gap to FIRE' : 'Surplus above FIRE'}</div>
        <div class="metric-value">${fmt(Math.abs(r.gap))}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Peak nest egg floor</div>
        <div class="metric-value">${fmt(r.peakFloor)}</div>
        <div class="metric-sub">Required at peak spending age</div>
      </div>
      <div class="metric-card ${tier.cls}">
        <div class="metric-label">Retirement safety</div>
        <div class="metric-value metric-value-sm">${tier.label}</div>
        <div class="metric-sub">${tier.detail}</div>
      </div>
      ${r.projectedAtRetire !== null ? `
      <div class="metric-card ${r.projectedAtRetire >= r.minNestEgg ? 'metric-green' : 'metric-red'}">
        <div class="metric-label">Projected net worth at end of earning</div>
        <div class="metric-value">${fmt(r.projectedAtRetire)}</div>
        <div class="metric-sub">After ${r.inputs.earningYears} yr${r.inputs.earningYears !== 1 ? 's' : ''} earning</div>
      </div>` : ''}
    </div>`;
}

function showResults() {
  const r = computeResults();
  state.results = r;

  const html = `
    <div class="results-container" id="results-page">
      <div class="results-header">
        <button class="btn-ghost" onclick="resetApp()">← Recalculate</button>
      </div>

      <div id="hero-wrap">${heroHTML(r)}</div>
      <div id="share-wrap">${shareCardHTML(r)}</div>
      <div id="metrics-wrap">${metricsHTML(r)}</div>
      <div id="suggestions-wrap">${suggestionsHTML(r)}</div>

      <div class="charts-grid">
        <div class="chart-card">
          <div class="chart-title">Portfolio vs Required Floor</div>
          <canvas id="portfolioChart"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">Withdrawal Rate by Age</div>
          <canvas id="withdrawalChart"></canvas>
        </div>
      </div>

      <div class="assumptions-block">
        <div class="assumptions-title">Adjust assumptions</div>
        <div class="assumptions-sliders">
          <div class="form-group">
            <label>Portfolio growth rate</label>
            <div class="slider-row">
              <input type="range" id="a-growthRate" min="2" max="15" step="0.5" value="${(r.inputs.growthRate * 100).toFixed(1)}" oninput="document.getElementById('a-growthDisplay').textContent=this.value+'%';refreshResults()">
              <span class="slider-val" id="a-growthDisplay">${(r.inputs.growthRate * 100).toFixed(1)}%</span>
            </div>
          </div>
          <div class="form-group">
            <label>Model to age</label>
            <div class="slider-row">
              <input type="range" id="a-modelToAge" min="75" max="100" value="${r.inputs.modelToAge}" oninput="document.getElementById('a-ageToDisplay').textContent=this.value;refreshResults()">
              <span class="slider-val" id="a-ageToDisplay">${r.inputs.modelToAge}</span>
            </div>
          </div>
        </div>
        <div class="spending-curve-note">
          Spending curve: ramps from ${fmt(r.inputs.currentSpend)}/mo → ${fmt(r.inputs.peakSpend)}/mo by 35,
          flat to 50, tapers to ${fmt(r.inputs.currentSpend * 1.4, 0)}/mo by 65,
          ${fmt(r.inputs.currentSpend * 1.2, 0)}/mo by 75,
          rising to ${fmt(r.inputs.currentSpend * 1.2 + r.inputs.peakSpend * 0.2, 0)}/mo by 90.
        </div>
      </div>
    </div>
  `;

  document.getElementById('questionnaire').style.display = 'none';
  document.getElementById('results').innerHTML = html;
  document.getElementById('results').style.display = 'block';

  renderCharts(r);
}

function refreshResults() {
  // Read assumption sliders back into state
  const g = document.getElementById('a-growthRate');
  const m = document.getElementById('a-modelToAge');
  if (!g || !m) return;

  state.inputs.growthRate = parseFloat(g.value) / 100;
  state.inputs.modelToAge = parseInt(m.value);

  const r = computeResults(true); // skip suggestions recompute on slider change
  state.results = r;

  document.getElementById('hero-wrap').innerHTML = heroHTML(r);
  document.getElementById('share-wrap').innerHTML = shareCardHTML(r);
  document.getElementById('metrics-wrap').innerHTML = metricsHTML(r);

  // Destroy old charts before redrawing
  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};
  renderCharts(r);
}

function renderCharts(r) {
  const retireAge = r.inputs.isEarning ? r.inputs.currentAge + r.inputs.earningYears : r.inputs.currentAge;
  const sim = r.sim;
  const labels = sim.portfolioByAge.map(d => d.age);
  const portfolioVals = sim.portfolioByAge.map(d => Math.max(0, d.value));
  const floorVals = sim.floorByAge.map(d => d.value);

  // Split portfolio into accumulation and drawdown
  const accumData = portfolioVals.map((v, i) => sim.portfolioByAge[i].age < retireAge ? v : null);
  const drawdownData = portfolioVals.map((v, i) => sim.portfolioByAge[i].age >= retireAge ? v : null);

  // Fill gaps so lines connect
  const connectAccum = portfolioVals.map((v, i) => {
    const age = sim.portfolioByAge[i].age;
    if (age < retireAge) return v;
    if (age === retireAge) return v;
    return null;
  });

  Chart.defaults.color = '#8b8fa8';
  Chart.defaults.font.family = "'DM Sans', sans-serif";

  // Portfolio chart
  chartInstances.portfolio = new Chart(document.getElementById('portfolioChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Accumulation',
          data: connectAccum,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74,222,128,0.07)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          spanGaps: false,
        },
        {
          label: 'Drawdown',
          data: drawdownData,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.07)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          spanGaps: false,
        },
        {
          label: 'Required floor',
          data: floorVals,
          borderColor: '#f87171',
          borderDash: [6, 3],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'Age' } },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { callback: v => fmt(v) },
        },
      },
    },
  });

  // Withdrawal rate chart — bars coloured by safety tier
  const rateData = sim.rateByAge.filter(d => isFinite(d.rate));

  function barColor(rate, alpha) {
    if (rate <= 0.03)  return `rgba(74,222,128,${alpha})`;   // green
    if (rate <= 0.035) return `rgba(251,191,36,${alpha})`;   // amber
    if (rate <= 0.04)  return `rgba(251,146,60,${alpha})`;   // orange
    return `rgba(248,113,113,${alpha})`;                     // red
  }

  const labelCfg = (content, color) => ({
    content, display: true, position: 'end', color,
    backgroundColor: 'transparent', font: { size: 10 },
  });

  chartInstances.withdrawal = new Chart(document.getElementById('withdrawalChart'), {
    type: 'bar',
    data: {
      labels: rateData.map(d => d.age),
      datasets: [{
        label: 'Withdrawal rate',
        data: rateData.map(d => parseFloat((d.rate * 100).toFixed(3))),
        backgroundColor: rateData.map(d => barColor(d.rate, 0.6)),
        borderColor:     rateData.map(d => barColor(d.rate, 1)),
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            line30: { type: 'line', yMin: 3,   yMax: 3,   borderColor: '#4ade80', borderDash: [4,3], borderWidth: 1, label: labelCfg('3%',   '#4ade80') },
            line35: { type: 'line', yMin: 3.5, yMax: 3.5, borderColor: '#fbbf24', borderDash: [4,3], borderWidth: 1, label: labelCfg('3.5%', '#fbbf24') },
            line40: { type: 'line', yMin: 4,   yMax: 4,   borderColor: '#f87171', borderDash: [4,3], borderWidth: 1, label: labelCfg('4%',   '#f87171') },
          },
        },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.y.toFixed(2)}%` } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, title: { display: true, text: 'Age' } },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { callback: v => v + '%' },
          title: { display: true, text: 'Withdrawal %' },
        },
      },
    },
  });
}

function resetApp() {
  document.getElementById('questionnaire').style.display = 'block';
  document.getElementById('results').style.display = 'none';
  state.currentStep = 1;
  renderStep();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderStep();
});
