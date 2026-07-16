const { ipcRenderer } = require("electron");

// CORE UI ELEMENTS
const urlInput = document.getElementById("url-input");
const loadBtn = document.getElementById("load-btn");
const presetSelect = document.getElementById("preset-dimensions");
const ratioWidth = document.getElementById("ratio-width");
const ratioHeight = document.getElementById("ratio-height");
const swapRatioBtn = document.getElementById("swap-ratio-btn");
const viewContainer = document.getElementById("view-container");
const targetView = document.getElementById("target-view");
const workspace = document.getElementById("workspace");
const progressBar = document.getElementById("progress-bar");

// BOTTOM DOCK DIAGNOSTIC UTILITIES
const clearCacheCb = document.getElementById("clear-cache-cb");
const clearDnsCb = document.getElementById("clear-dns-cb");
const clearCookiesCb = document.getElementById("clear-cookies-cb");
const xrayModeCb = document.getElementById("xray-mode-cb");
const darkModeCb = document.getElementById("dark-mode-cb");
const presetScaleSelect = document.getElementById("preset-scale");

// ACTION UTILITY BUTTONS
const jsToggleBtn = document.getElementById("js-toggle-btn");
const cssToggleBtn = document.getElementById("css-toggle-btn");
const screenshotBtn = document.getElementById("screenshot-btn");
// const longScreenshotBtn = document.getElementById('long-screenshot-btn');

// NETWORK ELEMENTS
const networkPreset = document.getElementById("network-preset-select");
const networkSpeedInput = document.getElementById("network-speed-input");

const reportBtn = document.getElementById("report-btn");
const reportPanel = document.getElementById("report-panel");
const runAuditBtn = document.getElementById("run-audit-btn");
const reportLoadingOverlay = document.getElementById("report-loading-overlay");
const reportLoadingText = document.getElementById("report-loading-text");

let isReportOpen = false;

// GLOBAL STATE MANAGERS
let isJavaScriptEnabled = true;
let isCssEnabled = true;
let userZoomScale = 1;
let fitScale = 1;
let targetWidth = "100%";
let targetHeight = "100%";

const SCALE_STEPS = [50, 75, 100, 125, 150, 200];
let currentScaleIndex = 2; // Index pointing at default 100%

const openFullReportBtn = document.getElementById("open-full-report-btn");
let lastReportHtml = null;

const runDiagnosticsBtn = document.getElementById('run-diagnostics-btn');
const diagnosticsResults = document.getElementById('diagnostics-results');

let selectedFormFactor = 'mobile';


// ==========================================================================
// CORE NAVIGATION & WORKSPACE LIFECYCLE
// ==========================================================================
async function navigate() {
  let url = urlInput.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  urlInput.value = url;
  urlInput.blur();

  // 1. Clear session parameters first based on checkboxes
  await dispatchNetworkThrottle();

  // 2. Now trigger the clean navigation assignment
  targetView.src = url;
}

// Cleaned up single listener (No duplicate hidden below it anymore!)
targetView.addEventListener("did-start-loading", () => {
  progressBar.classList.add("loading");
  progressBar.style.width = "15%";
});

targetView.addEventListener("did-get-response-details", () => {
  let currentWidth = parseInt(progressBar.style.width, 10) || 15;
  if (currentWidth < 85) progressBar.style.width = currentWidth + 8 + "%";
});

targetView.addEventListener("dom-ready", () => {
  if ((parseInt(progressBar.style.width, 10) || 15) < 95)
    progressBar.style.width = "95%";
  applyNativeZoom();
  if (!isCssEnabled) disablePageStyles();
});

targetView.addEventListener("did-stop-loading", () => {
  progressBar.style.width = "100%";
  setTimeout(() => {
    progressBar.classList.remove("loading");
    setTimeout(() => {
      progressBar.style.width = "0%";
    }, 150);
  }, 200);
});

targetView.addEventListener("did-fail-load", () => {
  progressBar.classList.remove("loading");
  progressBar.style.width = "0%";
});

targetView.addEventListener("did-navigate", updateHistoryUI);
targetView.addEventListener("did-navigate-in-page", updateHistoryUI);

const backBtn = document.getElementById("back-btn");
const forwardBtn = document.getElementById("forward-btn");
const refreshBtn = document.getElementById("refresh-btn");

function updateHistoryUI() {
  urlInput.value = targetView.getURL();
  if (backBtn && forwardBtn) {
    backBtn.disabled = !targetView.canGoBack();
    forwardBtn.disabled = !targetView.canGoForward();
  }
}

if (backBtn)
  backBtn.addEventListener("click", () => {
    if (targetView.canGoBack()) targetView.goBack();
  });
if (forwardBtn)
  forwardBtn.addEventListener("click", () => {
    if (targetView.canGoForward()) targetView.goForward();
  });

// Route the refresh action through navigate() to preserve configuration tracking
if (refreshBtn)
  refreshBtn.addEventListener("click", () => {
    navigate();
  });

// ==========================================================================
// RESPONSIVE CENTERING & LAYOUT MATH ENGINE
// ==========================================================================
function calculateFitScale() {
  if (targetWidth === "100%" || targetHeight === "100%") {
    fitScale = 1;
    return;
  }
  const workspaceW = workspace.clientWidth - 80;
  const workspaceH = workspace.clientHeight - 80;
  fitScale = Math.min(workspaceW / targetWidth, workspaceH / targetHeight);
}

function updateDimensions(w, h) {
  const widthStr = w.toString().trim();
  const heightStr = h.toString().trim();

  if (widthStr.includes("%") || heightStr.includes("%")) {
    targetWidth = "100%";
    targetHeight = "100%";
    viewContainer.style.width = "100%";
    viewContainer.style.height = "100%";
    ratioWidth.value = "";
    ratioHeight.value = "";
  } else {
    targetWidth = parseInt(widthStr, 10) || 100;
    targetHeight = parseInt(heightStr, 10) || 100;
    viewContainer.style.width = `${targetWidth}px`;
    viewContainer.style.height = `${targetHeight}px`;
    ratioWidth.value = targetWidth;
    ratioHeight.value = targetHeight;
  }
  renderFinalTransform();
}

function renderFinalTransform() {
  calculateFitScale();
  viewContainer.style.transform = `translate(-50%, -50%) scale(${fitScale})`;
}

// ==========================================================================
// CONTENT ZOOM ACTIONS
// ==========================================================================
function applyNativeZoom() {
  try {
    targetView.setZoomFactor(userZoomScale);
  } catch (e) {}
}

presetScaleSelect.addEventListener("change", (e) => {
  const scalePercent = parseInt(e.target.value, 10);
  userZoomScale = scalePercent / 100;
  currentScaleIndex = SCALE_STEPS.indexOf(scalePercent);
  applyNativeZoom();
});

workspace.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY > 0 && currentScaleIndex > 0) currentScaleIndex--;
      else if (e.deltaY < 0 && currentScaleIndex < SCALE_STEPS.length - 1)
        currentScaleIndex++;

      const targetScale = SCALE_STEPS[currentScaleIndex];
      presetScaleSelect.value = targetScale.toString();
      userZoomScale = targetScale / 100;
      applyNativeZoom();
    }
  },
  { passive: false },
);

// ==========================================================================
// CDP NETWORK THROTTLING PIPELINE BRIDGE
// ==========================================================================
async function dispatchNetworkThrottle() {
  if (!networkPreset) return;
  const type = networkPreset.value;
  let conditions = {
    offline: false,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  };

  if (type === "fast3g") {
    conditions = {
      offline: false,
      latency: 150,
      downloadThroughput: (1.5 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    };
    networkSpeedInput.value = "1.5";
  } else if (type === "slow3g") {
    conditions = {
      offline: false,
      latency: 400,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (150 * 1024) / 8,
    };
    networkSpeedInput.value = "0.4";
  } else if (type === "offline") {
    conditions = {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    };
    networkSpeedInput.value = "0";
  } else if (type === "custom") {
    const mbps = parseFloat(networkSpeedInput.value) || 0;
    if (mbps <= 0) {
      conditions = {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      };
    } else {
      const bytesPerSec = (mbps * 1024 * 1024) / 8;
      conditions = {
        offline: false,
        latency: mbps < 2 ? 200 : 60,
        downloadThroughput: bytesPerSec,
        uploadThroughput: bytesPerSec * 0.5,
      };
    }
  } else {
    networkSpeedInput.value = "";
  }

  let webContentsId = 0;
  try {
    webContentsId = targetView.getWebContentsId();
  } catch (e) {
    console.warn(
      "Webview ID resolving too early, relying on fallback targeting.",
    );
  }

  // CRITICAL FIX: Switch to invoke and await the response
  try {
    await ipcRenderer.invoke("apply-network-throttle", {
      webContentsId,
      conditions,
      keepCache: clearCacheCb.checked,
      keepDns: clearDnsCb.checked,
      keepCookies: clearCookiesCb.checked,
    });
  } catch (error) {
    console.error("Failed to apply network rules:", error);
  }
}

if (networkPreset)
  networkPreset.addEventListener("change", (e) => {
    if (e.target.value !== "custom") dispatchNetworkThrottle();
  });
if (networkSpeedInput)
  networkSpeedInput.addEventListener("input", () => {
    networkPreset.value = "custom";
    dispatchNetworkThrottle();
  });

// ==========================================================================
// DIAGNOSTIC VISUAL INJECTIONS
// ==========================================================================
xrayModeCb.addEventListener("change", () => {
  if (xrayModeCb.checked) {
    targetView
      .insertCSS(
        `* { outline: 1px solid rgba(74, 103, 86, 0.35) !important; outline-offset: -1px !important; }`,
        { cssOrigin: "author" },
      )
      .then((key) => {
        window.xrayCssKey = key;
      });
  } else if (window.xrayCssKey) {
    targetView.removeInsertedCSS(window.xrayCssKey);
  }
});

darkModeCb.addEventListener("change", () => {
  targetView.executeJavaScript(
    `document.documentElement.setAttribute('data-user-color-scheme', '${darkModeCb.checked ? "dark" : "light"}');`,
  );
});

// ==========================================================================
// UTILITY ACTION TOGGLES
// ==========================================================================
jsToggleBtn.addEventListener("click", () => {
  isJavaScriptEnabled = !isJavaScriptEnabled;
  targetView.setAttribute("javascript", isJavaScriptEnabled ? "true" : "false");
  jsToggleBtn.classList.toggle("active", !isJavaScriptEnabled);
  targetView.reloadIgnoringCache();
});

function disablePageStyles() {
  targetView
    .insertCSS(
      `head style, head link[rel="stylesheet"], html * { display: block; content: none; background: none !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; transition: none !important; transform: none !important; float: none !important; position: static !important; width: auto !important; height: auto !important; max-width: none !important; max-height: none !important; min-width: 0 !important; min-height: 0 !important; margin: 8px !important; padding: 0 !important; color: #000000 !important; font-family: monospace !important; font-size: 13px !important; line-height: 1.4 !important; text-align: left !important; }`,
      { cssOrigin: "user" },
    )
    .then((key) => {
      window.cssKillKey = key;
    });
}

cssToggleBtn.addEventListener("click", () => {
  isCssEnabled = !isCssEnabled;
  cssToggleBtn.classList.toggle("active", !isCssEnabled);

  if (!isCssEnabled) {
    disablePageStyles();
  } else if (window.cssKillKey) {
    targetView.removeInsertedCSS(window.cssKillKey);
    targetView.reloadIgnoringCache();
  }
});

// ==========================================================================
// SCREENSHOT CONTROLLERS (SCROLL EXPANSION MECHANISM)
// ==========================================================================
async function processExecutionCapture(btnElement, fullPageScroll = false) {
  btnElement.classList.add("active");
  btnElement.style.pointerEvents = "none";

  const originalWidth = viewContainer.style.width;
  const originalHeight = viewContainer.style.height;

  try {
    let image;

    if (fullPageScroll) {
      const scrollHeight = await targetView.executeJavaScript(
        "Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight)",
      );

      viewContainer.style.height = `${scrollHeight}px`;
      await new Promise((resolve) => setTimeout(resolve, 150));
      image = await targetView.capturePage();
    } else {
      image = await targetView.capturePage();
    }

    ipcRenderer.send("save-screenshot", image.toPNG());
  } catch (err) {
    console.error("Frame Engine Failure:", err);
  } finally {
    if (fullPageScroll) {
      viewContainer.style.width = originalWidth;
      viewContainer.style.height = originalHeight;
    }

    setTimeout(() => {
      btnElement.classList.remove("active");
      btnElement.style.pointerEvents = "auto";
    }, 200);
  }
}

screenshotBtn.addEventListener("click", () =>
  processExecutionCapture(screenshotBtn, false),
);
// longScreenshotBtn.addEventListener('click', () => processExecutionCapture(longScreenshotBtn, true));

// KEYBOARD ACCESSIBILITY FOR DIV BUTTONS
[screenshotBtn].forEach((button) => {
  button.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      button.click();
    }
  });
});

// GLOBAL INITIALIZATION BINDINGS
loadBtn.addEventListener("click", navigate);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") navigate();
});

presetSelect.addEventListener("change", (e) => {
  if (e.target.value === "custom") return;
  const [width, height] = e.target.value.split(",");
  updateDimensions(width, height);
});

[ratioWidth, ratioHeight].forEach((input) => {
  input.addEventListener("input", () => {
    const w = ratioWidth.value.trim();
    const h = ratioHeight.value.trim();
    if (!w && !h) {
      presetSelect.value = "100%,100%";
      updateDimensions("100%", "100%");
    } else {
      presetSelect.value = "custom";
      updateDimensions(w || "100", h || "100");
    }
  });
});

swapRatioBtn.addEventListener("click", () => {
  const tempW = ratioWidth.value.trim();
  const tempH = ratioHeight.value.trim();
  if (tempW || tempH) {
    presetSelect.value = "custom";
    updateDimensions(tempH || "100", tempW || "100");
  }
});

window.addEventListener("resize", renderFinalTransform);
window.addEventListener("DOMContentLoaded", () => {
  targetView.src = "https://example.com";
  updateDimensions("100%", "100%");
});

reportBtn.addEventListener("click", () => {
  isReportOpen = !isReportOpen;
  reportPanel.classList.toggle("open", isReportOpen);
  reportBtn.classList.toggle("active", isReportOpen);
});

// Recenter the phone/device frame once the panel finishes resizing the row
reportPanel.addEventListener("transitionend", (e) => {
  if (e.propertyName === "flex-basis") renderFinalTransform();
});

document.querySelectorAll(".report-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".report-tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".report-tab")
      .forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

const AUDIT_STEPS = [
  "Attaching to live session...",
  "Simulating network pipeline...",
  "Measuring paint & layout metrics...",
  "Scoring accessibility & SEO...",
  "Compiling report...",
];

if (runAuditBtn) {
  runAuditBtn.addEventListener("click", async () => {

    runAuditBtn.disabled = true;
    runDiagnosticsBtn.disabled = true;

    reportLoadingOverlay.classList.remove("hidden");
    let stepIndex = 0;
    reportLoadingText.textContent = AUDIT_STEPS[0];
    const stepTimer = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, AUDIT_STEPS.length - 1);
      reportLoadingText.textContent = AUDIT_STEPS[stepIndex];
    }, 1800);

    try {
      let webContentsId = 0;
      try {
        webContentsId = targetView.getWebContentsId();
      } catch (e) {}

      const result = await ipcRenderer.invoke('run-report', { webContentsId, formFactor: selectedFormFactor });
      renderReportSummary(result.json);
      renderTopIssues(result.json);          // <-- add this
      renderFullReportPreview(result.json);
      lastReportHtml = result.html;
      openFullReportBtn.disabled = false;

    } catch (err) {
      console.error("Audit failed:", err);
      reportLoadingText.textContent = "Audit failed — check console.";
    } finally {
      clearInterval(stepTimer);
      setTimeout(() => reportLoadingOverlay.classList.add("hidden"), 400);
    }

    runAuditBtn.disabled = false;
    runDiagnosticsBtn.disabled = false;
  });
}

function renderReportSummary(lhResult) {
  const cats = lhResult.categories || {};
  const audits = lhResult.audits || {};

  const setScore = (id, cat) => {
    const el = document.getElementById(id);
    if (el && cats[cat]) el.textContent = Math.round(cats[cat].score * 100);
  };
  setScore("score-performance", "performance");
  setScore("score-accessibility", "accessibility");
  setScore("score-best-practices", "best-practices");
  setScore("score-seo", "seo");
}

if (openFullReportBtn) {
  openFullReportBtn.addEventListener("click", () => {
    if (lastReportHtml)
      ipcRenderer.invoke("open-full-report", { html: lastReportHtml });
  });
}

function renderFullReportPreview(lhJson) {
  const audits = Object.values(lhJson.audits || {});

  const opportunities = audits
    .filter(a => a.details?.type === 'opportunity' && a.numericValue > 0)
    .sort((a, b) => b.numericValue - a.numericValue)
    .slice(0, 5);

  const passed = audits.filter(a => a.score === 1).length;
  const failed = audits.filter(a => a.score !== null && a.score < 0.9).length;

  const oppRows = opportunities.map(a => `
    <div class="report-row">
      <span class="report-row-label">${a.title}</span>
      <span class="report-row-value">${a.displayValue || `~${Math.round(a.numericValue)} ms`}</span>
    </div>
  `).join('');

  document.getElementById('full-report-stats').innerHTML = `
    <div class="diag-score-compare" style="margin-bottom: 16px;">
      <div class="diag-score-block"><span>${passed}</span><label>Passed</label></div>
      <div class="diag-score-block"><span>${failed}</span><label>Flagged</label></div>
    </div>
    ${opportunities.length ? `
      <h4 class="issues-heading">Biggest opportunities</h4>
      <div class="report-list">${oppRows}</div>
    ` : '<p class="report-lede">No major optimization opportunities found.</p>'}
  `;
}



function renderTopIssues(lhJson) {
  const container = document.getElementById('top-issues-container');
  if (!container) return;

  const audits = Object.values(lhJson.audits || {});
  const issues = audits
    .filter(a => a.score !== null
      && a.score < 0.9
      && !['notApplicable', 'manual', 'informative'].includes(a.scoreDisplayMode))
    .sort((a, b) => a.score - b.score) // worst first
    .slice(0, 6);

  if (issues.length === 0) {
    container.innerHTML = '<p class="report-lede">No major issues found — nice work.</p>';
    return;
  }

  container.innerHTML = `
    <h4 class="issues-heading">Top issues to fix</h4>
    ${issues.map(a => {
      const severity = a.score < 0.5 ? 'severe' : 'moderate';
      const desc = (a.description || '').replace(/\[.*?\]\(.*?\)/g, '').trim();
      return `
        <div class="issue-row severity-${severity}">
          <div class="issue-title">${a.title}</div>
          <div class="issue-desc">${desc}</div>
        </div>
      `;
    }).join('')}
  `;
}


ipcRenderer.on('diagnostics-progress', (event, { phase }) => {
  reportLoadingText.textContent = phase === 'cold'
    ? 'Running cold load (cache wiped)...'
    : 'Running warm load (cache primed)...';
});



const METRIC_AUDITS = [
  { id: 'first-contentful-paint', label: 'First Contentful Paint' },
  { id: 'largest-contentful-paint', label: 'Largest Contentful Paint' },
  { id: 'speed-index', label: 'Speed Index' },
  { id: 'total-blocking-time', label: 'Total Blocking Time' },
  { id: 'cumulative-layout-shift', label: 'Cumulative Layout Shift' },
  { id: 'interactive', label: 'Time to Interactive' },
];

if (runDiagnosticsBtn) {
  runDiagnosticsBtn.addEventListener('click', async () => {
    runDiagnosticsBtn.disabled = true;
    runAuditBtn.disabled = true;
    reportLoadingOverlay.classList.remove('hidden');
    reportLoadingText.textContent = 'Preparing comparison...';
    diagnosticsResults.innerHTML = '';

    try {
      let webContentsId = 0;
      try { webContentsId = targetView.getWebContentsId(); } catch (e) {}
      const { cold, warm } = await ipcRenderer.invoke('run-diagnostics-comparison', { webContentsId, formFactor: selectedFormFactor });
      renderDiagnosticsComparison(cold, warm);
    } catch (err) {
      console.error('Diagnostics comparison failed:', err);
      diagnosticsResults.innerHTML = '<p>Comparison failed — check console.</p>';
    } finally {
      runDiagnosticsBtn.disabled = false;
      runAuditBtn.disabled = false;
      reportLoadingOverlay.classList.add('hidden');
    }
  });
}

function renderDiagnosticsComparison(cold, warm) {
  const coldScore = Math.round((cold.categories.performance?.score || 0) * 100);
  const warmScore = Math.round((warm.categories.performance?.score || 0) * 100);
  const delta = warmScore - coldScore;

  const metricRows = METRIC_AUDITS.map(({ id, label }) => {
    const c = cold.audits[id];
    const w = warm.audits[id];
    if (!c || !w) return '';
    return `
      <div class="diag-row">
        <span class="diag-label">${label}</span>
        <span class="diag-value">${c.displayValue || '--'}</span>
        <span class="diag-arrow">→</span>
        <span class="diag-value diag-value-warm">${w.displayValue || '--'}</span>
      </div>
    `;
  }).join('');

  diagnosticsResults.innerHTML = `
    <div class="diag-score-compare">
      <div class="diag-score-block"><span>${coldScore}</span><label>Cold Load</label></div>
      <div class="diag-delta ${delta >= 0 ? 'positive' : 'negative'}">${delta >= 0 ? '+' : ''}${delta}</div>
      <div class="diag-score-block"><span>${warmScore}</span><label>Warm Load</label></div>
    </div>
    <div class="diag-metrics">
      <div class="diag-row diag-header">
        <span class="diag-label">Metric</span><span class="diag-value">Cold</span><span class="diag-arrow"></span><span class="diag-value">Warm</span>
      </div>
      ${metricRows}
    </div>
  `;
}


document.querySelectorAll('.device-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.device-toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFormFactor = btn.dataset.formfactor;
  });
});


