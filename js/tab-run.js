// ═══════════════════════════════════════════════════════════
// TAB-RUN — dashboard controls, log viewer, save/load
// ═══════════════════════════════════════════════════════════
import { positions, steps, setPositions, setSteps, uid } from './state.js';
import { RELAY, dashPause, dashStop, dashSpeed, setDot } from './network.js';
import { renderPositions } from './tab-setup.js';
import { renderSteps, refreshCode, buildCode } from './tab-program.js';

const inputIds = {
  js: 'settings-js',
  ja: 'settings-ja',
  ls: 'settings-ls',
  la: 'settings-la',
  br: 'settings-br',
  tcpX: 'settings-tcp-x',
  tcpY: 'settings-tcp-y',
  tcpZ: 'settings-tcp-z',
  tcpRx: 'settings-tcp-rx',
  tcpRy: 'settings-tcp-ry',
  tcpRz: 'settings-tcp-rz',
  plW: 'settings-pl-w',
  plX: 'settings-pl-x',
  plY: 'settings-pl-y',
  plZ: 'settings-pl-z'
};

function initSettingsInputs() {
  import('./state.js').then(s => {
    for (const [stateKey, inputId] of Object.entries(inputIds)) {
      const el = document.getElementById(inputId);
      if (el) {
        el.value = s.globalSettings[stateKey];
        el.addEventListener('input', () => {
          s.setGlobalSettings({ [stateKey]: parseFloat(el.value) || 0 });
          refreshCode();
        });
      }
    }
  });
}

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

  // Initialize defaults inputs
  initSettingsInputs();

  // Start log polling
  startLogPoller();
  startUiLogPoller();
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
    let compiledCode = buildCode(); 

    // 1. Automatically extract the Relay IP your popup system is already using successfully
    const ipMatch = compiledCode.match(/socket_open\("([^"]+)"/);
    const relayIp = ipMatch ? ipMatch[1] : "127.0.0.1";

    // 2. Globally redirect ALL native textmsg calls to our new UI interceptor function
    let finalScript = compiledCode.replace(/textmsg\(/g, 'ui_textmsg(');

    // 3. Define the interceptor function to handle both 1-argument and 2-argument logs
    // (Automated logs use textmsg(0, "Gripper Open"), so we grab the second argument if it exists!)
    const logInterceptorFunction = `
    def ui_textmsg(a1, a2=""):
        if (a2 == ""):
            textmsg(a1)
            socket_open("${relayIp}", 50001, "auto_log")
            socket_send_string(to_str(a1), "auto_log")
            socket_close("auto_log")
        else:
            textmsg(a1, a2)
            socket_open("${relayIp}", 50001, "auto_log")
            socket_send_string(to_str(a2), "auto_log")
            socket_close("auto_log")
        end
    end
`;

    // 4. Inject the interceptor function safely right at the top of master_program
    finalScript = finalScript.replace('def master_program():', `def master_program():${logInterceptorFunction}`);

    const res = await fetch(RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: ip, code: finalScript }) 
    });
    
    const data = await res.json();
    
    if (data.ok) {
      setDot('ok');
      btn.innerHTML = '▶︎ RUNNING!';
      btn.style.background = 'var(--gn)';
      btn.style.borderColor = 'var(--gn)';
      logLine('Program accepted. Full logging pipeline active.');
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
  import('./state.js').then(s => {
    const data = { positions, steps, settings: s.globalSettings };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    a.download = 'ur3e_project.json';
    a.click();
  });
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
      import('./state.js').then(s => {
        if (data.settings) {
          s.setGlobalSettings(data.settings);
          for (const [stateKey, inputId] of Object.entries(inputIds)) {
            const el = document.getElementById(inputId);
            if (el) el.value = s.globalSettings[stateKey] ?? el.value;
          }
        }
        renderPositions();
        renderSteps();
        refreshCode();
        logLine('Project loaded successfully.');
      });
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

function startUiLogPoller() {
  async function poll() {
    try {
      const res = await fetch(RELAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch_logs' })
      });
      const data = await res.json();
      
      // If Python sends back an array of messages, print each one!
      if (data.ok && data.logs && data.logs.length > 0) {
        data.logs.forEach(msg => logLine(`[Robot] ${msg}`));
      }
    } catch(e) { 
      /* silently ignore network drops */ 
    }
    // Poll twice a second for near-instant updates
    setTimeout(poll, 500); 
  }
  setTimeout(poll, 1000);
}