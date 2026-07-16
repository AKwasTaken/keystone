![Banner](assets/banner.jpg)

A desktop performance workbench built in Electron. Keystone gives you a controllable browser window with device emulation, network throttling, and cache/cookie control, plus a full built-in reporting suite so you don't have to bounce between five different websites and paywalled tools to understand how a page actually performs.

Everything runs locally on your machine. Nothing is sent to a third-party server to generate these reports.

---

## What it does

### The browser workbench

* **Device emulation** with presets for common phones, tablets, and monitors, or a custom width and height of your own.
* **Network throttling** with Fast 3G, Slow 3G, offline, and custom Mbps profiles, applied through the same protocol Chrome DevTools uses internally.
* **Cache, DNS, and cookie control** so you can choose exactly what carries over between page loads, useful for testing a genuine first-time visitor experience versus a returning one.
* **JavaScript and CSS toggles** to see what a page looks like and how it behaves with either one turned off.
* **X-Ray mode** to outline every element on the page, and a **dark mode override** independent of the site's own theme.
* **Screenshot capture**, saved straight to your Pictures folder.
* **Native DevTools** access for the loaded page, one click away.

### The Reports panel

Click the report icon in the dock to open a side panel with the following tabs:

* **Summary** - Performance, Accessibility, Best Practices, and SEO scores at a glance, along with a plain list of the biggest issues found and why they matter.
* **Full Report** - A preview of the top opportunities for improvement, with a button to open the complete, official Lighthouse report in its own window.
* **Diagnostics** - Runs the page twice, once with an empty cache and once with a warm one, and shows you the real difference caching makes to load time.
* **Security** - Checks the response headers and connection for the essentials: HTTPS, HSTS, Content-Security-Policy, and a few other protections that are easy to forget. This is a passive check of configuration, not a vulnerability scanner.
* **Coverage** - Shows exactly how much of the downloaded JavaScript and CSS was never actually used on this page load, sorted by wasted bytes.
* **Baseline** - Runs the same audit across your current page and up to two other URLs side by side, so you can compare your site against a competitor or an earlier version of your own work.
* **Runtime** - A live graph of main-thread activity and memory use while you actually interact with the page, for catching slowdowns and leaks that only show up after the page has already loaded.

---

## How it works, briefly

Keystone uses Electron's `<webview>` tag as the browser surface you interact with, and talks to it directly over the Chrome DevTools Protocol for throttling and cache control.

For anything that runs a full audit (Summary, Diagnostics, Security, Coverage, Baseline), Keystone launches a separate, temporary instance of `chrome-headless-shell` in the background. This is a stripped-down, headless-only build of Chromium made for exactly this kind of automation. It's used instead of a full Chrome install so nothing has to already be on your system for these reports to work, and instead of a full Chromium download so the app stays as light as it reasonably can. Each audit closes its browser instance when it's done.

Everything is built on Google's own Lighthouse engine underneath, the same one that powers PageSpeed Insights. Keystone doesn't reimplement any of that scoring logic. It just gives you a nicer, unified place to run it, without hitting a paywall or a request limit.

---

## Installation and setup

These steps are the same regardless of which operating system you're on, since Electron apps are cross-platform by default. The differences between platforms are called out where they matter.

### Prerequisites

You'll need two things installed first:

* **Node.js** (version 18 or later). Download it from [nodejs.org](https://nodejs.org), or install it through a package manager (see below).
* **Git**, to clone the repository.

**macOS**, using Homebrew:
```bash
brew install node git
```

**Windows**, using winget (built into modern Windows) or [nodejs.org](https://nodejs.org) directly:
```powershell
winget install OpenJS.NodeJS
winget install Git.Git
```

**Linux**, using your distribution's package manager. For example, on Debian or Ubuntu:
```bash
sudo apt update
sudo apt install nodejs npm git
```

### Step 1: Clone the repository

```bash
git clone https://github.com/yourusername/keystone.git
cd keystone
```

### Step 2: Install dependencies

```bash
npm install
```

### Step 3: Install the headless browser

Keystone's reporting features depend on `chrome-headless-shell`, which is a separate download from the main app. This only needs to be done once.

```bash
npx puppeteer browsers install chrome-headless-shell
```

### Step 4: Run the app

```bash
npm start
```

That's it. The main window should open with the workbench ready to go.

---

## Platform-specific notes

### macOS

No extra steps beyond the ones above. This is the platform Keystone has been actively developed and tested on. Download the latest version from the Releases page.

### Windows

The same four steps apply. If `npm install` fails partway through with a permissions error, try running your terminal as Administrator. If Windows Defender or another antivirus flags the `chrome-headless-shell` download, that's a false positive common with automated browser binaries. You may need to allow it through.

### Linux

The same four steps apply. `chrome-headless-shell` has some system library dependencies that a minimal or headless server install might not already have, most commonly `libnss3`, `libatk-1.0`, `libcups2`, and `libgbm1`. If the app fails to launch a report with a missing shared library error, install these through your package manager. On Debian or Ubuntu:

```bash
sudo apt install libnss3 libatk-1.0-0 libcups2 libgbm1 libasound2
```

Keystone has not yet been tested end-to-end on Windows or Linux by me, since development happened on a Mac. If you run into something that doesn't work as described here, please open an issue with the error message and your OS version.

---

## Building a standalone app

Running `npm start` launches Keystone in development mode, which requires Node and the cloned repository to be present every time. If you want a proper installable application (a `.dmg`, `.exe`, or `.AppImage`) that can run without any of that, Keystone can be packaged using [Electron Builder](https://www.electron.build/). This is a separate, optional step and isn't required just to use the app yourself.

```bash
npm install --save-dev electron-builder
npx electron-builder
```

Packaged builds are meaningfully larger than the source repository, since they bundle a full copy of Chromium for the app window itself, on top of the `chrome-headless-shell` download used for reports.

---

## Troubleshooting

**"Could not find Chrome" error when running a report.**
The `chrome-headless-shell` download from Step 3 didn't complete or was skipped. Run `npx puppeteer browsers install chrome-headless-shell` again from inside the project folder.

**A report tab shows a failure, but the rest of the app still works.**
This is expected behavior, not a crash. Each report is isolated on purpose, so if one audit hits a site that behaves unusually, only that one result is affected rather than the whole app.

**Scores change slightly between runs of the same page.**
A few points of variance run to run is normal and expected. Lighthouse measures a real page load each time, and small timing differences are part of how that works. It is not a sign that anything is broken.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.