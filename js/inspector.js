let devtoolsToggleBtn = null;
let inspectorTargetView = null;

function toggleNativeInspector() {
  if (!inspectorTargetView) {
    inspectorTargetView = document.getElementById('target-view');
  }
  if (!inspectorTargetView) return;

  try {
    if (inspectorTargetView.isDevToolsOpened()) {
      inspectorTargetView.closeDevTools();
      if (devtoolsToggleBtn) devtoolsToggleBtn.classList.remove('active');
    } else {
      inspectorTargetView.openDevTools({ mode: 'detach' });
      if (devtoolsToggleBtn) devtoolsToggleBtn.classList.add('active');
    }
  } catch (err) {
    console.error('Failed to interface with native Chromium DevTools:', err);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  inspectorTargetView = document.getElementById('target-view');
  devtoolsToggleBtn = document.getElementById('devtools-toggle-btn');

  if (devtoolsToggleBtn) {
    devtoolsToggleBtn.addEventListener('click', toggleNativeInspector);
  }
});

window.toggleNativeInspector = toggleNativeInspector;
