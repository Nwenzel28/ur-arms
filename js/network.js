// ═══════════════════════════════════════════════════════════
// NETWORK — all fetch() calls to relay.py
// ═══════════════════════════════════════════════════════════
import { steps, positions, isJogging, setIsJogging, setIsFreedrive, fdAxes } from './state.js';
import { buildCode } from './tab-program.js';

export const RELAY = 'http://localhost:5678';

export function setDot(state) {
  const dot = document.getElementById('robot-dot');
  const map = {
    idle:    {bg:'var(--tx3)',          shadow:'none'},
    pinging: {bg:'var(--yl,#f59e0b)',   shadow:'none'},
    ok:      {bg:'var(--gn)',           shadow:'0 0 7px var(--gn)'},
    err:     {bg:'var(--rd)',           shadow:'none'},
    sending: {bg:'var(--bl)',           shadow:'0 0 7px var(--bl)'},
  };
  const cfg = map[state] || map.idle;
  if (dot) { dot.style.background = cfg.bg; dot.style.boxShadow = cfg.shadow; }
}

export async function pingRobot() {
  const btn = document.getElementById('ping-btn');
  const ip  = document.getElementById('robot-ip').value.trim();
  if (!ip) { alert('Enter the robot IP address first.'); return; }
  btn.textContent = '…';
  btn.disabled = true;
  setDot('pinging');
  try {
    const res  = await fetch(RELAY, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ip, code:'# ping\n'})
    });
    const data = await res.json();
    if (data.ok) {
      setDot('ok');
      btn.textContent = '✓ Connected';
      btn.style.color = 'var(--gn)';
    } else {
      throw new Error(data.error || 'Robot refused connection');
    }
  } catch(e) {
    setDot('err');
    btn.textContent = 'Failed';
    btn.style.color = 'var(--rd)';
    const isRelay = e.message.includes('fetch') || e.message.includes('Failed to fetch');
    setTimeout(() => alert(
      isRelay
        ? 'Cannot reach the relay server.\n\nMake sure it is still running:\n  python3 relay.py'
        : `Could not connect to robot at ${ip}.\n\nError: ${e.message}`
    ), 50);
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = 'Ping'; btn.style.color = ''; }, 3000);
  }
}

export function sendDirect(codeStr) {
  const ip = document.getElementById('robot-ip').value.trim();
  if (!ip) return;
  fetch(RELAY, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ip, code: codeStr, action:'send'})
  });
}

export function emergencyStop() {
  console.error('EMERGENCY STOP TRIGGERED');
  sendDirect('protective_stop()\n');
  resetFreedriveUI();
}

export function resetFreedriveUI() {
  setIsFreedrive(false);
  const btn = document.getElementById('btn-freedrive');
  if (btn) {
    btn.textContent = 'Freedrive';
    btn.classList.remove('btn-ac');
  }
}

export function startFreedriveDetection() {
  const ip = document.getElementById('robot-ip').value;
  if (!ip) return setTimeout(startFreedriveDetection, 250);

  fetch(RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dashboard_status', ip: ip })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok && data.raw) {
      if (data.raw.includes("STOPPED") || data.raw.includes("PAUSED")) {
        resetFreedriveUI();
      }
    }
  })
  .finally(() => {
    setTimeout(startFreedriveDetection, 250);
  });
}

export async function fetchRobotState() {
  const ip = document.getElementById('robot-ip').value.trim();
  if (!ip) return;
  try {
    const res  = await fetch(RELAY, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ip, action:'state'})
    });
    const data = await res.json();
    const tcp    = data.tcp    || data.actual_TCP_pose || data.pose || data.cartesian;
    const joints = data.joints || data.actual_joint_positions || data.q_actual || data.q;

    if (tcp && tcp.length >= 6) {
      import('./state.js').then(s => s.setLatestTcp(tcp));
    }
    if (joints && joints.length >= 6) {
      import('./state.js').then(s => s.setLatestJoints(joints));
    }
    return { tcp, joints };
  } catch(e) {
    console.error('Failed to read robot state', e);
  }
}

export function startJog(axis, direction) {
  setIsJogging(true);
  resetFreedriveUI();
  let vector = [0, 0, 0, 0, 0, 0];
  vector[axis] = direction * (axis < 3 ? 0.05 : 0.25);
  const speedlCmd = `def jog():\n  while True:\n    speedl([${vector.join(',')}], a=0.3, t=0.1)\n  end\nend\n`;
  sendDirect(speedlCmd);
}

export function stopJog() {
  if (!isJogging) return;
  setIsJogging(false);
  sendDirect("def stop_jog():\n  stopl(2.5)\nend\n");
}

export async function dashPlay()  { const ip = document.getElementById('robot-ip').value.trim(); if (!ip) return; fetch(RELAY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dashboard_play',ip})}); }
export async function dashPause() { const ip = document.getElementById('robot-ip').value.trim(); if (!ip) return; fetch(RELAY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dashboard_pause',ip})}); }
export async function dashStop()  { const ip = document.getElementById('robot-ip').value.trim(); if (!ip) return; fetch(RELAY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dashboard_stop',ip})}); }
export async function dashSpeed(val) { const ip = document.getElementById('robot-ip').value.trim(); if (!ip) return; fetch(RELAY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dashboard_speed',ip,fraction:val/100})}); }

export function startPopupPoller() {
  function checkPopups() {
    fetch(RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check_popup' })
    })
    .then(r => r.json())
    .then(data => {
      const modal = document.getElementById('ui-modal');
      const msgEl = document.getElementById('ui-modal-msg');
      if (data.ok && data.msg) {
        msgEl.innerText = data.msg;
        modal.style.display = 'flex';
      } else {
        modal.style.display = 'none';
      }
    })
    .catch(err => console.log("Popup poll error:", err))
    .finally(() => { setTimeout(checkPopups, 500); });
  }
  setTimeout(checkPopups, 1000);
}

export function resolvePopup() {
  document.getElementById('ui-modal').style.display = 'none';
  fetch(RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'resolve_popup' })
  });
}
