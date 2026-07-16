const runSecurityBtn = document.getElementById('run-security-btn');
const securityResults = document.getElementById('security-results');

const runCoverageBtn = document.getElementById('run-coverage-btn');
const coverageResults = document.getElementById('coverage-results');

const runBaselineBtn = document.getElementById('run-baseline-btn');
const baselineResults = document.getElementById('baseline-results');

const toggleProfilerBtn = document.getElementById('toggle-profiler-btn');
const runtimeChart = document.getElementById('runtime-chart');
const runtimeStats = document.getElementById('runtime-stats');
const ctx = runtimeChart?.getContext('2d');

const resetProfilerBtn = document.getElementById('reset-profiler-btn');
const CHART_PAD = { top: 14, right: 46, bottom: 14, left: 34 };


let profilerRunning = false;
const MAX_SAMPLES = 60;
const heapSamples = [];
const busySamples = [];


if (runSecurityBtn) {
  runSecurityBtn.addEventListener('click', async () => {
    runSecurityBtn.disabled = true;
    securityResults.innerHTML = '<p class="report-lede">Scanning...</p>';
    try {
      let webContentsId = 0;
      try { webContentsId = targetView.getWebContentsId(); } catch (e) {}
      const result = await ipcRenderer.invoke('run-security-scan', { webContentsId });
      renderSecurityResults(result);
    } catch (err) {
      console.error('Security scan failed:', err);
      securityResults.innerHTML = '<p>Scan failed — check console.</p>';
    } finally {
      runSecurityBtn.disabled = false;
    }
  });
}

function renderSecurityResults(result) {
  const { checks, protocol, status } = result;
  const rows = checks.rules.map(r => `
    <div class="security-row ${r.pass ? 'pass' : 'fail'}">
      <span class="security-badge">${r.pass ? '✓' : '✕'}</span>
      <div class="security-text">
        <div class="security-label">${r.label}</div>
        <div class="security-detail">${r.detail}</div>
      </div>
    </div>
  `).join('');

  securityResults.innerHTML = `
    <div class="diag-score-compare" style="margin-bottom:12px;">
      <div class="diag-score-block"><span>${checks.passed}/${checks.total}</span><label>Checks Passed</label></div>
      <div class="diag-score-block"><span>${protocol.toUpperCase()}</span><label>Protocol</label></div>
    </div>
    ${rows}
  `;
}









if (runCoverageBtn) {
  runCoverageBtn.addEventListener('click', async () => {
    runCoverageBtn.disabled = true;
    coverageResults.innerHTML = '<p class="report-lede">Scanning...</p>';
    try {
      let webContentsId = 0;
      try { webContentsId = targetView.getWebContentsId(); } catch (e) {}
      const result = await ipcRenderer.invoke('run-coverage-scan', { webContentsId });
      renderCoverageResults(result);
    } catch (err) {
      console.error('Coverage scan failed:', err);
      coverageResults.innerHTML = '<p>Scan failed — check console.</p>';
    } finally {
      runCoverageBtn.disabled = false;
    }
  });
}

function renderCoverageResults({ js, css }) {
  const renderList = (label, entries) => {
    const rows = entries.slice(0, 8).map(e => `
      <div class="report-row">
        <span class="report-row-label">${e.url.split('/').pop() || e.url}</span>
        <span class="report-row-value">${(e.unusedBytes / 1024).toFixed(1)} KB unused (${e.unusedPercent}%)</span>
      </div>
    `).join('');
    return `<h4 class="issues-heading">${label}</h4><div class="report-list">${rows || '<p class="report-lede">Nothing significant found.</p>'}</div>`;
  };

  coverageResults.innerHTML = renderList('JavaScript', js) + renderList('CSS', css);
}



ipcRenderer.on('baseline-progress', (event, { url }) => {
  reportLoadingText.textContent = `Auditing ${url}...`;
});

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
}

if (runBaselineBtn) {
  runBaselineBtn.addEventListener('click', async () => {
    const url1 = normalizeUrl(document.getElementById('baseline-url-1').value);
    const url2 = normalizeUrl(document.getElementById('baseline-url-2').value);
    const currentUrl = targetView.getURL();
    const urls = [currentUrl, url1, url2].filter(Boolean);

    if (urls.length < 2) {
      baselineResults.innerHTML = '<p>Enter at least one comparison URL.</p>';
      return;
    }

    runBaselineBtn.disabled = true;
    reportLoadingOverlay.classList.remove('hidden');
    reportLoadingText.textContent = 'Starting comparison...';

    try {
      const results = await ipcRenderer.invoke('run-baseline-comparison', { urls, formFactor: selectedFormFactor });
      renderBaselineResults(results);
    } catch (err) {
      console.error('Baseline comparison failed:', err);
      baselineResults.innerHTML = '<p>Comparison failed — check console.</p>';
    } finally {
      runBaselineBtn.disabled = false;
      reportLoadingOverlay.classList.add('hidden');
    }
  });
}

const BASELINE_METRICS = [
  { id: 'largest-contentful-paint', label: 'LCP' },
  { id: 'total-blocking-time', label: 'TBT' },
  { id: 'cumulative-layout-shift', label: 'CLS' },
  { id: 'total-byte-weight', label: 'Page Weight' },
];

function renderBaselineResults(results) {
  const header = `<div class="baseline-row baseline-header"><span></span>${results.map(r => `<span>${new URL(r.url).hostname}</span>`).join('')}</div>`;
  const scoreRow = `<div class="baseline-row"><span class="baseline-metric-label">Performance</span>${results.map(r => `<span>${Math.round((r.json.categories.performance?.score || 0) * 100)}</span>`).join('')}</div>`;

  const metricRows = BASELINE_METRICS.map(({ id, label }) => {
    const cells = results.map(r => `<span>${r.json.audits[id]?.displayValue || '--'}</span>`).join('');
    return `<div class="baseline-row"><span class="baseline-metric-label">${label}</span>${cells}</div>`;
  }).join('');

  baselineResults.innerHTML = `<div class="baseline-table">${header}${scoreRow}${metricRows}</div>`;
}



if (toggleProfilerBtn) {
  toggleProfilerBtn.addEventListener('click', async () => {
    let webContentsId = 0;
    try { webContentsId = targetView.getWebContentsId(); } catch (e) {}

    if (!profilerRunning) {
      await ipcRenderer.invoke('start-runtime-profiler', { webContentsId });
      profilerRunning = true;
      toggleProfilerBtn.textContent = 'Stop Monitoring';
    } else {
      await ipcRenderer.invoke('stop-runtime-profiler', { webContentsId });
      profilerRunning = false;
      toggleProfilerBtn.textContent = 'Start Monitoring';
    }
  });
}

ipcRenderer.on('runtime-profiler-data', (event, data) => {
  heapSamples.push(data.jsHeapUsed);
  busySamples.push(data.mainThreadBusyPercent);
  if (heapSamples.length > MAX_SAMPLES) { heapSamples.shift(); busySamples.shift(); }

  runtimeStats.innerHTML = `
    <div class="diag-score-compare">
      <div class="diag-score-block"><span>${(data.jsHeapUsed / 1048576).toFixed(1)} MB</span><label>JS Heap</label></div>
      <div class="diag-score-block"><span>${data.mainThreadBusyPercent}%</span><label>Main Thread Busy</label></div>
    </div>
  `;
  drawRuntimeChart();
});

function drawRuntimeChart() {
  if (!ctx) return;
  const rect = runtimeChart.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  if (w === 0 || h === 0) return;
  ctx.clearRect(0, 0, w, h);

  const plotLeft = CHART_PAD.left;
  const plotRight = w - CHART_PAD.right;
  const plotTop = CHART_PAD.top;
  const plotBottom = h - CHART_PAD.bottom;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const maxHeap = Math.max(...heapSamples, 1024 * 1024); // floor of 1MB so scale never collapses to 0

  // Grid lines + dual axis labels
  ctx.strokeStyle = '#e5dec9';
  ctx.lineWidth = 1;
  ctx.font = '10px Outfit, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5c646c';

  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = plotTop + (plotH * i) / steps;
    const pct = 100 - (i * 100) / steps;
    const heapAtLine = maxHeap * (1 - i / steps);

    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();

    ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, plotLeft - 6, y);

    ctx.textAlign = 'left';
    ctx.fillText(`${(heapAtLine / 1048576).toFixed(1)}MB`, plotRight + 6, y);
  }

  const drawLine = (samples, maxVal, color) => {
    if (samples.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((v, i) => {
      const x = plotLeft + (i / (MAX_SAMPLES - 1)) * plotW;
      const y = plotBottom - (Math.min(v, maxVal) / maxVal) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  drawLine(busySamples, 100, '#b86b5c');
  drawLine(heapSamples, maxHeap, '#4a6b6c');
}

// Stop profiler if navigating away, to avoid a dangling interval in main.js
targetView.addEventListener('did-start-loading', () => {
  if (profilerRunning) {
    let webContentsId = 0;
    try { webContentsId = targetView.getWebContentsId(); } catch (e) {}
    ipcRenderer.invoke('stop-runtime-profiler', { webContentsId });
    profilerRunning = false;
    if (toggleProfilerBtn) toggleProfilerBtn.textContent = 'Start Monitoring';
  }
});

function resizeRuntimeCanvas() {
  if (!runtimeChart) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = runtimeChart.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return; // still hidden, skip
  runtimeChart.width = rect.width * dpr;
  runtimeChart.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawRuntimeChart();
}

window.addEventListener('resize', resizeRuntimeCanvas);
// Call once when the tab is first shown, since a hidden element reports 0 size
document.querySelector('[data-tab="runtime"]')?.addEventListener('click', () => {
  setTimeout(resizeRuntimeCanvas, 0);
});

let runtimeResizeObserver = null;
if (runtimeChart) {
  runtimeResizeObserver = new ResizeObserver(() => resizeRuntimeCanvas());
  runtimeResizeObserver.observe(runtimeChart);
}


function renderBaselineResults(results) {
  const header = `<div class="baseline-row baseline-header"><span></span>${results.map(r => `<span>${new URL(r.url).hostname}</span>`).join('')}</div>`;

  const scoreRow = `<div class="baseline-row"><span class="baseline-metric-label">Performance</span>${results.map(r =>
    r.json ? `<span>${Math.round((r.json.categories.performance?.score || 0) * 100)}</span>` : `<span title="${r.error}">Failed</span>`
  ).join('')}</div>`;

  const metricRows = BASELINE_METRICS.map(({ id, label }) => {
    const cells = results.map(r => `<span>${r.json?.audits[id]?.displayValue || '--'}</span>`).join('');
    return `<div class="baseline-row"><span class="baseline-metric-label">${label}</span>${cells}</div>`;
  }).join('');

  baselineResults.innerHTML = `<div class="baseline-table">${header}${scoreRow}${metricRows}</div>`;
}


if (resetProfilerBtn) {
  resetProfilerBtn.addEventListener('click', () => {
    heapSamples.length = 0;
    busySamples.length = 0;
    runtimeStats.innerHTML = '';
    drawRuntimeChart(); // clears the canvas since both sample arrays are now empty
  });
}