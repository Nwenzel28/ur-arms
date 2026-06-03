// ═══════════════════════════════════════════════════════════
// TAB-RUN — dashboard controls, log viewer, save/load
// ═══════════════════════════════════════════════════════════
import { positions, steps, setPositions, setSteps, uid } from './state.js';
import { RELAY, dashPlay, dashPause, dashStop, dashSpeed } from './network.js';
import { renderPositions } from './tab-setup.js';
import { renderSteps, refreshCode } from './tab-program.js';

export function initRunTab() {
  // Speed slider
  const slider = document.getElementById('dash-speed-slider');
  const label  = document.getElementById('speed-label');
  if (slider) {
    slider.addEventListener('input', () => {
      label.textContent = slider.value + '%';
      dashSpeed(+slider.value);
    });
  }

  // Dashboard play/pause/stop
  document.getElementById('dash-play')?.addEventListener('click',  dashPlay);
  document.getElementById('dash-pause')?.addEventListener('click', dashPause);
  document.getElementById('dash-stop')?.addEventListener('click',  dashStop);

  // Save / load project
  document.getElementById('btn-save-project')?.addEventListener('click', exportProject);
  document.getElementById('file-import-project')?.addEventListener('change', e => importProject(e.target));

  // Start log polling
  startLogPoller();
}

function exportProject() {
  const data = { positions, steps };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
  a.download = 'ur3e_project.json';
  a.click();
}

function importProject(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.positions) setPositions(data.positions);
      if (data.steps) {
        const fixed = data.steps.map(s => ({ ...s, id: s.id || uid() }));
        setSteps(fixed);
      }
      renderPositions();
      renderSteps();
      refreshCode();
      logLine('Project loaded successfully.');
    } catch(err) {
      alert("Error loading project: " + err);
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function logLine(msg) {
  const el = document.getElementById('live-logs');
  if (!el) return;
  const ts = new Date().toLocaleTimeString();
  el.innerHTML += `\n<span style="color:var(--tx3)">[${ts}]</span> ${msg}`;
  el.scrollTop = el.scrollHeight;
}

function startLogPoller() {
  async function poll() {
    const ip = document.getElementById('robot-ip').value.trim();
    if (ip) {
      try {
        const res  = await fetch(RELAY, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({action:'dashboard_status', ip})
        });
        const data = await res.json();
        if (data.ok && data.raw) {
          const el = document.getElementById('live-logs');
          // Only update if status actually changed
          if (el && el._lastStatus !== data.raw) {
            el._lastStatus = data.raw;
            logLine(`Robot status: ${data.raw.trim()}`);
          }
        }
      } catch(e) { /* silent */ }
    }
    setTimeout(poll, 2000);
  }
  setTimeout(poll, 2000);
}
