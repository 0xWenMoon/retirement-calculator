// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  currentStep: 1,
  totalSteps: 4,
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

// ─── Results computation ──────────────────────────────────────────────────────

function computeResults() {
  const inp = state.inputs;
  const minNestEgg = findMinNestEgg(inp);

  // Full simulation from current net worth for charts
  const sim = simulate(inp.netWorth, inp);

  // Projected net worth at end of earning period
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

  // Find peak floor (max of floor across all ages)
  const minSim = simulate(minNestEgg, inp);
  const peakFloor = Math.max(...minSim.floorByAge.map(d => d.value));

  const currentAnnualSpend = annualSpend(inp.currentAge, inp.currentSpend, inp.peakSpend);
  const effectiveWithdrawalRate = inp.netWorth > 0 ? currentAnnualSpend / inp.netWorth : Infinity;

  const gap = minNestEgg - inp.netWorth;
  const canRetireNow = gap <= 0;

  let verdict;
  if (canRetireNow) {
    verdict = 'green';
  } else if (inp.isEarning && projectedAtRetire !== null && projectedAtRetire >= minNestEgg) {
    verdict = 'amber';
  } else {
    verdict = 'red';
  }

  // How many years until nest egg is met (amber path)
  let yearsToFire = null;
  if (!canRetireNow && inp.isEarning) {
    let p = inp.netWorth;
    for (let y = 1; y <= 50; y++) {
      const age = inp.currentAge + y;
      const spend = annualSpend(age, inp.currentSpend, inp.peakSpend);
      p = p * (1 + inp.growthRate) + (inp.annualIncome - spend);
      // Check if from this point forward it passes
      const testInputs = { ...inp, currentAge: age, netWorth: p, isEarning: false, earningYears: 0 };
      const testMin = findMinNestEgg(testInputs);
      if (p >= testMin) {
        yearsToFire = y;
        break;
      }
    }
  }

  return {
    minNestEgg,
    netWorth: inp.netWorth,
    gap,
    peakFloor,
    projectedAtRetire,
    effectiveWithdrawalRate,
    canRetireNow,
    verdict,
    yearsToFire,
    sim,
    minSim,
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
  } else if (s === 4) {
    state.inputs.growthRate = (parseFloat(document.getElementById('growthRate').value) || 7) / 100;
    state.inputs.withdrawalRate = (parseFloat(document.getElementById('withdrawalRate').value) || 3.5) / 100;
    state.inputs.modelToAge = parseInt(document.getElementById('modelToAge').value) || 90;
  }
}

// ─── Render Steps ─────────────────────────────────────────────────────────────

function renderStep() {
  const container = document.getElementById('app');
  updateProgressBar();

  const stepRenderers = [null, renderStep1, renderStep2, renderStep3, renderStep4];
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
      <div class="step-label">Step 1 of 4</div>
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
        <input type="text" id="netWorth" value="${i.netWorth > 0 ? i.netWorth.toLocaleString() : ''}" placeholder="e.g. 250,000">
      </div>
    </div>
    <div class="form-group">
      <label>Current monthly spend</label>
      <div class="input-prefix">
        <span>$</span>
        <input type="text" id="currentSpend" value="${i.currentSpend > 0 ? i.currentSpend.toLocaleString() : ''}" placeholder="e.g. 5,000">
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
      <div class="step-label">Step 2 of 4</div>
      <h2>Future spending</h2>
      <p class="step-desc">What's the peak you expect your spending to reach?</p>
    </div>
    <div class="form-group">
      <label>Expected peak monthly spend</label>
      <p class="field-hint">Think: family, mortgage, lifestyle peak — typically ages 35–50</p>
      <div class="input-prefix">
        <span>$</span>
        <input type="text" id="peakSpend" value="${displayVal.toLocaleString()}" placeholder="e.g. 10,000">
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
      <div class="step-label">Step 3 of 4</div>
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
          <input type="text" id="annualIncome" value="${i.annualIncome > 0 ? i.annualIncome.toLocaleString() : ''}" placeholder="e.g. 150,000">
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
    ${stepButtons(true, true)}
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
  // nothing extra needed — inline handlers cover it
}

function toggleEarning(val) {
  document.getElementById('earning-fields').style.display = val ? 'block' : 'none';
  document.getElementById('earningLabel').textContent = val ? 'Yes' : 'No';
}

// ─── Results ──────────────────────────────────────────────────────────────────

function showResults() {
  const r = computeResults();
  state.results = r;

  const verdictConfig = {
    green: {
      cls: 'verdict-green',
      icon: '✦',
      title: 'You can retire now.',
      subtitle: `Your net worth exceeds the minimum nest egg by ${fmt(Math.abs(r.gap))}.`,
    },
    amber: {
      cls: 'verdict-amber',
      icon: '◈',
      title: r.yearsToFire !== null ? `${r.yearsToFire} more year${r.yearsToFire === 1 ? '' : 's'} of earning needed.` : 'Keep earning — you\'re on track.',
      subtitle: r.yearsToFire !== null
        ? `At your current income and savings rate, you reach FIRE in ${r.yearsToFire} year${r.yearsToFire === 1 ? '' : 's'}.`
        : `Your projected net worth at retirement may not clear the constraint — review below.`,
    },
    red: {
      cls: 'verdict-red',
      icon: '⚠',
      title: `You need ${fmt(r.gap)} more.`,
      subtitle: `Your current trajectory doesn't reach the minimum nest egg. Increase income, reduce spend, or extend your earning years.`,
    },
  };

  const v = verdictConfig[r.verdict];
  const wr = r.effectiveWithdrawalRate;
  const wrFlag = wr > r.inputs.withdrawalRate;

  const html = `
    <div class="results-container" id="results-page">
      <div class="results-header">
        <button class="btn-ghost" onclick="resetApp()">← Recalculate</button>
        <h1 class="brand">Retirement Calculator</h1>
      </div>

      <div class="verdict-banner ${v.cls}">
        <div class="verdict-icon">${v.icon}</div>
        <div>
          <div class="verdict-title">${v.title}</div>
          <div class="verdict-sub">${v.subtitle}</div>
        </div>
      </div>

      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Minimum nest egg needed</div>
          <div class="metric-value">${fmt(r.minNestEgg)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Your current net worth</div>
          <div class="metric-value">${fmt(r.netWorth)}</div>
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
        ${r.projectedAtRetire !== null ? `
        <div class="metric-card ${r.projectedAtRetire >= r.minNestEgg ? 'metric-green' : 'metric-red'}">
          <div class="metric-label">Projected net worth at end of earning</div>
          <div class="metric-value">${fmt(r.projectedAtRetire)}</div>
          <div class="metric-sub">After ${r.inputs.earningYears} yr${r.inputs.earningYears !== 1 ? 's' : ''} earning</div>
        </div>` : ''}
        <div class="metric-card ${wrFlag ? 'metric-red' : ''}">
          <div class="metric-label">Effective withdrawal rate today</div>
          <div class="metric-value ${wrFlag ? 'text-red' : ''}">${fmtPct(wr)}</div>
          ${wrFlag ? `<div class="metric-sub text-red">Exceeds ${fmtPct(r.inputs.withdrawalRate)} cap</div>` : ''}
        </div>
      </div>

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
        <div class="assumptions-title">Model assumptions</div>
        <div class="assumptions-grid">
          <div><span class="a-label">Current age</span><span>${r.inputs.currentAge}</span></div>
          <div><span class="a-label">Monthly spend</span><span>${fmt(r.inputs.currentSpend)}/mo</span></div>
          <div><span class="a-label">Peak monthly spend</span><span>${fmt(r.inputs.peakSpend)}/mo</span></div>
          <div><span class="a-label">Portfolio growth</span><span>${fmtPct(r.inputs.growthRate)}/yr</span></div>
          <div><span class="a-label">Withdrawal cap</span><span>${fmtPct(r.inputs.withdrawalRate)}</span></div>
          <div><span class="a-label">Modelled to age</span><span>${r.inputs.modelToAge}</span></div>
          ${r.inputs.isEarning ? `
          <div><span class="a-label">Annual income</span><span>${fmt(r.inputs.annualIncome)}</span></div>
          <div><span class="a-label">Earning years</span><span>${r.inputs.earningYears}</span></div>` : ''}
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
  new Chart(document.getElementById('portfolioChart'), {
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

  // Withdrawal rate chart
  const rateData = sim.rateByAge.filter(d => isFinite(d.rate));
  const cap = r.inputs.withdrawalRate;

  new Chart(document.getElementById('withdrawalChart'), {
    type: 'bar',
    data: {
      labels: rateData.map(d => d.age),
      datasets: [
        {
          label: 'Withdrawal rate',
          data: rateData.map(d => parseFloat((d.rate * 100).toFixed(3))),
          backgroundColor: rateData.map(d => d.rate > cap ? 'rgba(248,113,113,0.7)' : 'rgba(74,222,128,0.5)'),
          borderColor: rateData.map(d => d.rate > cap ? '#f87171' : '#4ade80'),
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            capLine: {
              type: 'line',
              yMin: cap * 100,
              yMax: cap * 100,
              borderColor: '#f87171',
              borderDash: [6, 3],
              borderWidth: 1.5,
              label: { content: `${fmtPct(cap)} cap`, display: true, position: 'end', color: '#f87171', backgroundColor: 'transparent' },
            },
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
