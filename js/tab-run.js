// ═══════════════════════════════════════════════════════════
// TAB-RUN — dashboard controls, log viewer, save/load
// ═══════════════════════════════════════════════════════════
import { positions, steps, setPositions, setSteps, uid } from './state.js';
import { RELAY, dashPause, dashStop, dashSpeed, setDot } from './network.js';
import { renderPositions } from './tab-setup.js';
import { renderSteps, refreshCode, buildCode } from './tab-program.js';

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
  document.getElementById('dash-play')?.addEventListener('click',  playProgram); // ◄ Changed to our new compile & send function
  document.getElementById('dash-pause')?.addEventListener('click', dashPause);
  document.getElementById('dash-stop')?.addEventListener('click',  dashStop);

  // Save / load project
  document.getElementById('btn-save-project')?.addEventListener('click', exportProject);
  document.getElementById('file-import-project')?.addEventListener('change', e => importProject(e.target));

  // Start log polling
  startLogPoller();
}

/**
 * SMART PLAY: 
 * If the robot is paused, it resumes via Port 29999.
 * If stopped/idle, it compiles and sends fresh code to Port 30002.
 */
async function playProgram() {
  const ip = document.getElementById('robot-ip').value.trim();
  if (!ip) { 
    alert('Enter the robot IP address first.'); 
    return; 
  }
  
  const btn = document.getElementById('dash-play');
  const originalText = btn.innerHTML;
  
  // 1. Check if the robot is currently in a paused state
  const logs = document.getElementById('live-logs');
  const isPaused = logs && logs._lastStatus && logs._lastStatus.toLowerCase().includes('paused');

  if (isPaused) {
    // ── RESUME EXISTING PROGRAM (Port 29999) ──
    btn.innerHTML = '▶︎ RESUMING...';
    btn.disabled = true;
    logLine('Resuming paused program...');
    
    try {
      const res = await fetch(RELAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dashboard_play', ip: ip })
      });
      const data = await res.json();
      
      if (data.ok) {
        btn.innerHTML = '▶︎ RUNNING!';
        btn.style.background = 'var(--gn)';
        btn.style.borderColor = 'var(--gn)';
        logLine('Program resumed successfully.');
      } else {
        throw new Error(data.error);
      }
    } catch(e) {
      logLine(`Error resuming program: ${e.message}`);
    } finally {
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.disabled = false;
      }, 2500);
    }
    return; // Exit early so we don't send the new script!
  }

  // ── COMPILE AND SEND NEW PROGRAM (Port 30002) ──
  btn.innerHTML = '▶︎ SENDING...';
  btn.disabled = true;
  setDot('sending');
  logLine('Compiling and sending new program to robot...');

  try {
    const compiledCode = buildCode(); 
    
    const res = await fetch(RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: ip, code: compiledCode })
    });
    
    const data = await res.json();
    
    if (data.ok) {
      setDot('ok');
      btn.innerHTML = '▶︎ RUNNING!';
      btn.style.background = 'var(--gn)';
      btn.style.borderColor = 'var(--gn)';
      logLine('Program accepted. Execution started.');
    } else {
      throw new Error(data.error || 'Robot rejected the script');
    }
  } catch(e) {
    setDot('err');
    btn.innerHTML = '✕ FAILED';
    btn.style.background = 'var(--rd)';
    logLine(`Error sending program: ${e.message}`);
    alert(`Failed to send program:\n${e.message}`);
  } finally {
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.disabled = false;
    }, 2500);
  }
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