const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  dialog,
  webContents,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const os = require("node:os");

const puppeteer = require("puppeteer");

let auditInProgress = false;
let isAnyAuditRunning = false;

const activeProfilers = new Map();

app.commandLine.appendSwitch("remote-debugging-port", "9222");
app.commandLine.appendSwitch("remote-allow-origins", "*");

process.on("unhandledRejection", (reason) => {
  if (
    reason &&
    reason.message &&
    reason.message.includes("GUEST_VIEW_MANAGER_CALL")
  ) {
    return;
  }
  console.error("Unhandled Rejection:", reason);
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile("index.html");
}

async function withFreshPage(webContentsId, callback) {
  const targetWc = webContents.fromId(webContentsId);
  if (!targetWc)
    throw new Error("webContents not found for id " + webContentsId);
  const currentUrl = targetWc.getURL();

  const browser = await puppeteer.launch({
    headless: "shell",
  });

  try {
    let match = browser.targets().find((t) => t.url() === currentUrl);
    if (!match) {
      await new Promise((r) => setTimeout(r, 300));
      match = browser.targets().find((t) => t.url() === currentUrl);
    }
    if (!match)
      throw new Error("Could not locate CDP target for: " + currentUrl);

    const page = await match.page();
    return await callback(page);
  } finally {
    browser.disconnect();
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let responseHeaders = details.responseHeaders;
    const blocklist = [
      "x-frame-options",
      "content-security-policy",
      "frame-options",
    ];

    responseHeaders = Object.fromEntries(
      Object.entries(responseHeaders).filter(([key]) => {
        return !blocklist.includes(key.toLowerCase());
      }),
    );

    callback({ cancel: false, responseHeaders });
  });

  createWindow();

  ipcMain.on("save-screenshot", async (event, pngBuffer) => {
    try {
      const picturesPath = app.getPath("pictures");
      const targetDir = path.join(picturesPath, "Keystone_Screenshots");

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const filename = `capture_${Date.now()}.png`;
      const fullPath = path.join(targetDir, filename);

      fs.writeFile(fullPath, pngBuffer, (err) => {
        if (err) console.error("OS File Write Error:", err);
      });
    } catch (error) {
      console.error("Failed to parse system path metrics:", error);
    }
  });

  ipcMain.handle("apply-network-throttle", async (event, data) => {
    const { webContentsId, conditions, keepCache, keepDns, keepCookies } = data;
    const targetWc = webContents.fromId(webContentsId);
    if (!targetWc) return { success: false };

    const targetSession = targetWc.session;

    try {
      if (!keepCache) await targetSession.clearCache();
      if (!keepCookies) {
        await targetSession.clearStorageData({
          storages: ["cookies", "localstorage", "indexeddb"],
        });
      }
      if (!keepDns) await targetSession.clearHostResolverCache();

      if (!targetWc.debugger.isAttached()) {
        try {
          targetWc.debugger.attach("1.3");
        } catch (attachErr) {
          console.warn("Debugger already attached:", attachErr);
        }
      }

      await targetWc.debugger.sendCommand("Network.enable");

      if (!keepCache) {
        await targetWc.debugger.sendCommand("Network.clearBrowserCache");
        await targetWc.debugger.sendCommand("Network.setCacheDisabled", {
          cacheDisabled: true,
        });
      } else {
        await targetWc.debugger.sendCommand("Network.setCacheDisabled", {
          cacheDisabled: false,
        });
      }

      if (
        conditions.offline === false &&
        conditions.latency === 0 &&
        conditions.downloadThroughput === 0
      ) {
        await targetWc.debugger.sendCommand(
          "Network.emulateNetworkConditions",
          {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          },
        );
      } else {
        await targetWc.debugger.sendCommand(
          "Network.emulateNetworkConditions",
          {
            offline: conditions.offline,
            latency: conditions.latency,
            downloadThroughput: Math.round(conditions.downloadThroughput),
            uploadThroughput: Math.round(conditions.uploadThroughput),
          },
        );
      }

      return { success: true };
    } catch (err) {
      console.error("CDP Throttling Interceptor Failure:", err);
      throw err;
    }
  });

  ipcMain.handle(
    "run-report",
    withAuditLock(async (event, { webContentsId, formFactor }) => {
      const targetWc = webContents.fromId(webContentsId);
      if (!targetWc) throw new Error("webContents not found");
      const url = targetWc.getURL();

      const { default: lighthouse } = await import("lighthouse");
      const config = await buildLighthouseConfig(formFactor);
      const browser = await puppeteer.launch({ headless: "shell" });

      try {
        const port = new URL(browser.wsEndpoint()).port;
        const result = await lighthouse(
          url,
          getLighthouseFlags(formFactor, port),
        );

        return { json: JSON.parse(result.report[0]), html: result.report[1] };
      } finally {
        await browser.close();
      }
    }),
  );

  ipcMain.handle("open-full-report", async (event, { html }) => {
    const tempPath = path.join(
      os.tmpdir(),
      `keystone-report-${Date.now()}.html`,
    );
    fs.writeFileSync(tempPath, html, "utf-8");

    const reportWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      title: "Keystone — Full Lighthouse Report",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    reportWindow.loadFile(tempPath);
    return { success: true };
  });

  ipcMain.handle(
    "run-diagnostics-comparison",
    withAuditLock(async (event, { webContentsId, formFactor }) => {
      const targetWc = webContents.fromId(webContentsId);
      if (!targetWc) throw new Error("webContents not found");
      const url = targetWc.getURL();

      const { default: lighthouse } = await import("lighthouse");
      const browser = await puppeteer.launch({ headless: "shell" });

      try {
        const port = new URL(browser.wsEndpoint()).port;

        event.sender.send("diagnostics-progress", { phase: "cold" });
        const coldPage = await browser.newPage();
        const coldResult = await lighthouse(
          url,
          getLighthouseFlags(formFactor, port, {
            onlyCategories: ["performance"],
          }),
        );
        await coldPage.close();

        await new Promise((r) => setTimeout(r, 500));

        event.sender.send("diagnostics-progress", { phase: "warm" });
        const warmPage = await browser.newPage();
        const warmResult = await lighthouse(
          url,
          getLighthouseFlags(formFactor, port, {
            onlyCategories: ["performance"],
            disableStorageReset: true,
          }),
        );
        await warmPage.close();

        return {
          cold: JSON.parse(coldResult.report[0]),
          warm: JSON.parse(warmResult.report[0]),
        };
      } finally {
        await browser.close();
      }
    }),
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

async function buildLighthouseConfig(formFactor) {
  if (formFactor === "desktop") {
    const desktopConfig =
      await import("lighthouse/core/config/desktop-config.js");
    return desktopConfig.default;
  }
  return undefined;
}

function getLighthouseFlags(formFactor, port, extra = {}) {
  const base = {
    port,
    output: ["json", "html"],
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    ...extra,
  };

  if (formFactor === "desktop") {
    return {
      ...base,
      formFactor: "desktop",
      screenEmulation: {
        mobile: false,
        width: 1350,
        height: 940,
        deviceScaleFactor: 1,
        disabled: false,
      },
    };
  }

  return {
    ...base,
    formFactor: "mobile",
    screenEmulation: {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
      disabled: false,
    },
  };
}

function withAuditLock(handler) {
  return async (...args) => {
    if (auditInProgress) {
      throw new Error(
        "Another audit is already running. Please wait for it to finish.",
      );
    }
    auditInProgress = true;
    try {
      return await handler(...args);
    } finally {
      auditInProgress = false;
    }
  };
}

async function guardedAuditRun(fn) {
  if (isAnyAuditRunning) return;
  isAnyAuditRunning = true;
  runAuditBtn.disabled = true;
  runDiagnosticsBtn.disabled = true;
  try {
    await fn();
  } finally {
    isAnyAuditRunning = false;
    runAuditBtn.disabled = false;
    runDiagnosticsBtn.disabled = false;
  }
}






function evaluateSecurityHeaders(headers, url) {
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[k.toLowerCase()] = v;
  const isHttps = url.startsWith("https://");
  const cspVal = lower["content-security-policy"] || "";

  const rules = [
    { id: "https", label: "HTTPS", severity: "critical", pass: isHttps,
      detail: isHttps ? "Site is served over HTTPS." : "Not served over HTTPS — traffic is unencrypted." },
    { id: "hsts", label: "Strict-Transport-Security", severity: "high", pass: !!lower["strict-transport-security"],
      detail: lower["strict-transport-security"] || "Missing — HTTPS isn't enforced on future visits." },
    { id: "csp", label: "Content-Security-Policy", severity: "high", pass: !!cspVal,
      detail: cspVal || "Missing — increases XSS attack surface." },
    { id: "xcto", label: "X-Content-Type-Options", severity: "medium", pass: lower["x-content-type-options"] === "nosniff",
      detail: lower["x-content-type-options"] || "Missing — browsers may MIME-sniff responses." },
    { id: "xfo", label: "Clickjacking Protection", severity: "medium",
      pass: !!lower["x-frame-options"] || /frame-ancestors/.test(cspVal),
      detail: (lower["x-frame-options"] || /frame-ancestors/.test(cspVal)) ? "Present." : "Missing — page could be framed by another site." },
    { id: "referrer", label: "Referrer-Policy", severity: "low", pass: !!lower["referrer-policy"],
      detail: lower["referrer-policy"] || "Missing — full URLs may leak via Referer header." },
    { id: "permissions", label: "Permissions-Policy", severity: "low", pass: !!lower["permissions-policy"],
      detail: lower["permissions-policy"] ? "Present." : "Missing — no explicit limits on powerful browser features." },
  ];

  return { rules, passed: rules.filter(r => r.pass).length, total: rules.length };
}

ipcMain.handle("run-security-scan", withAuditLock(async (event, { webContentsId }) => {
  const targetWc = webContents.fromId(webContentsId);
  if (!targetWc) throw new Error("webContents not found");
  const url = targetWc.getURL();

  const browser = await puppeteer.launch({ headless: "shell" });
  try {
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send("Network.enable");

    let mainDoc = null;
    client.on("Network.responseReceived", (e) => {
      if (e.type === "Document" && !mainDoc) {
        mainDoc = { url: e.response.url, status: e.response.status, protocol: e.response.protocol, headers: e.response.headers };
      }
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 300));
    await client.detach();
    await page.close();

    if (!mainDoc) throw new Error("Could not capture the main document response.");
    return { ...mainDoc, checks: evaluateSecurityHeaders(mainDoc.headers, mainDoc.url) };
  } finally {
    await browser.close();
  }
}));





ipcMain.handle("run-baseline-comparison", withAuditLock(async (event, { urls, formFactor }) => {
  const { default: lighthouse } = await import("lighthouse");
  const browser = await puppeteer.launch({ headless: "shell" });
  const results = [];

  try {
    const port = new URL(browser.wsEndpoint()).port;

    for (const url of urls) {
      event.sender.send("baseline-progress", { url });
      try {
        const result = await lighthouse(url, getLighthouseFlags(formFactor, port, { onlyCategories: ["performance"] }));
        results.push({ url, json: JSON.parse(result.report[0]), error: null });
      } catch (err) {
        console.error(`Baseline audit failed for ${url}:`, err.message);
        results.push({ url, json: null, error: err.friendlyMessage || err.message });
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    return results;
  } finally {
    await browser.close();
  }
}));



ipcMain.handle("run-coverage-scan", withAuditLock(async (event, { webContentsId }) => {
  const targetWc = webContents.fromId(webContentsId);
  if (!targetWc) throw new Error("webContents not found");
  const url = targetWc.getURL();

  const browser = await puppeteer.launch({ headless: "shell" });
  try {
    const page = await browser.newPage();
    await Promise.all([
      page.coverage.startJSCoverage({ resetOnNavigation: false }),
      page.coverage.startCSSCoverage({ resetOnNavigation: false }),
    ]);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1000));

    const [jsCoverage, cssCoverage] = await Promise.all([
      page.coverage.stopJSCoverage(),
      page.coverage.stopCSSCoverage(),
    ]);
    await page.close();

    const summarize = (entries) => entries.map((entry) => {
      const totalBytes = entry.text.length;
      const usedBytes = entry.ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
      const unusedBytes = totalBytes - usedBytes;
      return {
        url: entry.url || "(inline)",
        totalBytes, unusedBytes,
        unusedPercent: totalBytes > 0 ? Math.round((unusedBytes / totalBytes) * 100) : 0,
      };
    }).sort((a, b) => b.unusedBytes - a.unusedBytes);

    return { js: summarize(jsCoverage), css: summarize(cssCoverage) };
  } finally {
    await browser.close();
  }
}));



ipcMain.handle("start-runtime-profiler", async (event, { webContentsId }) => {
  const targetWc = webContents.fromId(webContentsId);
  if (!targetWc) throw new Error("webContents not found");
  if (activeProfilers.has(webContentsId)) return { success: true };

  if (!targetWc.debugger.isAttached()) {
    try { targetWc.debugger.attach("1.3"); } catch (e) {}
  }
  await targetWc.debugger.sendCommand("Performance.enable");

  let lastTimestamp = null;
  let lastTaskDuration = 0;

  const intervalId = setInterval(async () => {
    try {
      const { metrics } = await targetWc.debugger.sendCommand("Performance.getMetrics");
      const map = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
      const now = Date.now();

      const taskDelta = lastTimestamp ? Math.max(0, map.TaskDuration - lastTaskDuration) : 0;
      const elapsedSec = lastTimestamp ? (now - lastTimestamp) / 1000 : 1;
      const mainThreadBusyPercent = lastTimestamp ? Math.min(100, Math.round((taskDelta / elapsedSec) * 100)) : 0;

      lastTimestamp = now;
      lastTaskDuration = map.TaskDuration || 0;

      event.sender.send("runtime-profiler-data", {
        timestamp: now,
        jsHeapUsed: map.JSHeapUsedSize || 0,
        mainThreadBusyPercent,
      });
    } catch (err) {
      console.error("Runtime profiler tick failed:", err);
    }
  }, 750);

  activeProfilers.set(webContentsId, intervalId);
  return { success: true };
});

ipcMain.handle("stop-runtime-profiler", async (event, { webContentsId }) => {
  const intervalId = activeProfilers.get(webContentsId);
  if (intervalId) {
    clearInterval(intervalId);
    activeProfilers.delete(webContentsId);
  }
  return { success: true };
});