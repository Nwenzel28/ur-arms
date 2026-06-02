// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let cfgOpen = true;
let _uid = 0;
const uid = () => 'u' + (_uid++);

let positions = [
  {id:uid(), name:'HOME',     j:[0.00,-1.5708,0.00,-1.5708,-1.5708,0.00], c:[-0.2667,-0.1304,0.6942,-1.2113,-1.2071,1.2057]},
  {id:uid(), name:'APPROACH', j:[0.00,-1.5708,0.00,-1.5708,-1.5708,0.00], c:[-0.2667,-0.1304,0.6942,-1.2113,-1.2071,1.2057]},
  {id:uid(), name:'PICK',     j:[0.00,-1.5708,0.00,-1.5708,-1.5708,0.00], c:[-0.2667,-0.1304,0.6942,-1.2113,-1.2071,1.2057]},
  {id:uid(), name:'PLACE',    j:[0.00,-1.5708,0.00,-1.5708,-1.5708,0.00], c:[-0.2667,-0.1304,0.6942,-1.2113,-1.2071,1.2057]},
];

let steps = [];

// ═══════════════════════════════════════════════════════════
// LIVE GRIPPER CONTROL
// ═══════════════════════════════════════════════════════════

function activateGripper() {
  const btnAct = document.getElementById('btn-gripper-activate');
  const btnOpn = document.getElementById('btn-gripper-open');
  const btnCls = document.getElementById('btn-gripper-close');
  const ip = document.getElementById('robot-ip').value;
  
  if (!ip) {
    alert("Please enter the Robot IP first.");
    return;
  }

  btnAct.innerText = 'Activating...';
  btnAct.disabled = true;

  resetFreedriveUI();

  const urscript = `def live_grp():\n  socket_close("rq_srv")\n  socket_open("127.0.0.1", 63352, "rq_srv")\n  socket_send_string("SET ACT 1", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET GTO 1", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_close("rq_srv")\nend\nlive_grp()`;

  fetch(RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send', ip: ip, code: urscript })
  })
  .then(r => r.json())
  .then(res => {
    if (res.ok) {
      const checkStatus = async () => {
        try {
          const statusRes = await fetch(RELAY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'gripper_status', ip: ip })
          });
          const data = await statusRes.json();
          
          // Wait for Activation to Complete (STA === 3)
          if (data.ok && data.gsta === 3) {
            btnAct.style.display = 'none';   // Hide Activate button
            btnOpn.style.display = 'block';  // Show Open button
            btnCls.style.display = 'block';  // Show Close button
            return; 
          }
          setTimeout(checkStatus, 250);
        } catch (err) {
          setTimeout(checkStatus, 500); 
        }
      };
      setTimeout(checkStatus, 500);
    } else {
      alert("Error sending command: " + res.error);
      btnAct.disabled = false;
      btnAct.innerText = 'Activate Gripper';
    }
  })
  .catch(err => {
    console.error(err);
    alert("Network error. Is relay.py running?");
    btnAct.disabled = false;
  });
}

function moveGripper(direction) {
  const btnOpn = document.getElementById('btn-gripper-open');
  const btnCls = document.getElementById('btn-gripper-close');
  const ip = document.getElementById('robot-ip').value;

  // Lock both buttons while moving
  btnOpn.disabled = true;
  btnCls.disabled = true;
  
  resetFreedriveUI();

  let urscript = '';

  if (direction === 'open') {
    btnOpn.innerText = 'Opening...';
    urscript = `def live_grp():\n  socket_close("rq_srv")\n  socket_open("127.0.0.1", 63352, "rq_srv")\n  socket_send_string("SET SPE 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET FOR 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET POS 0", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_close("rq_srv")\nend\nlive_grp()`;
  } else {
    btnCls.innerText = 'Closing...';
    urscript = `def live_grp():\n  socket_close("rq_srv")\n  socket_open("127.0.0.1", 63352, "rq_srv")\n  socket_send_string("SET SPE 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET FOR 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET POS 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_close("rq_srv")\nend\nlive_grp()`;
  }

  fetch(RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send', ip: ip, code: urscript })
  })
  .then(r => r.json())
  .then(res => {
    if (res.ok) {
      const checkStatus = async () => {
        try {
          const statusRes = await fetch(RELAY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'gripper_status', ip: ip })
          });
          const data = await statusRes.json();
          
          // Wait for Movement to Complete or Object Detected (OBJ !== 0)
          if (data.ok && data.gobj !== 0) {
            btnOpn.disabled = false;
            btnCls.disabled = false;
            btnOpn.innerText = 'Open';
            btnCls.innerText = 'Close';
            return; 
          }
          setTimeout(checkStatus, 250);
        } catch (err) {
          setTimeout(checkStatus, 500); 
        }
      };
      setTimeout(checkStatus, 500);
    } else {
      alert("Error sending command: " + res.error);
      btnOpn.disabled = false;
      btnCls.disabled = false;
      btnOpn.innerText = 'Open';
      btnCls.innerText = 'Close';
    }
  });
}

function initSteps() {
  const [home,approach,pick,place] = positions.map(p=>p.id);
  steps = [
    {id:uid(), type:'movej', pid:home},
    {id:uid(), type:'movej', pid:approach},
    {id:uid(), type:'movej', pid:pick},
    {id:uid(), type:'movej', pid:approach},
    {id:uid(), type:'movej', pid:place},
    {id:uid(), type:'movej', pid:home},
  ];
}

// ═══════════════════════════════════════════════════════════
// ROBOT CONNECTION
// ═══════════════════════════════════════════════════════════
const RELAY = 'http://localhost:5678';

function setDot(state) {
  const dot = document.getElementById('robot-dot');
  const sendBtn = document.getElementById('send-btn');
  const map = {
    idle:    {bg:'var(--tx3)',          shadow:'none',               send:false},
    pinging: {bg:'var(--yl,#f59e0b)',   shadow:'none',               send:false},
    ok:      {bg:'var(--gn)',           shadow:'0 0 7px var(--gn)',  send:true},
    err:     {bg:'var(--rd)',           shadow:'none',               send:false},
    sending: {bg:'var(--bl)',           shadow:'0 0 7px var(--bl)', send:false},
  };
  const cfg = map[state] || map.idle;
  dot.style.background = cfg.bg;
  dot.style.boxShadow  = cfg.shadow;
  sendBtn.disabled     = !cfg.send;
}

async function pingRobot() {
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
        : `Could not connect to robot at ${ip}.\n\nCheck:\n• Robot is powered on\n• IP address is correct\n• Robot is in Remote mode\n• Mac and robot are on the same network\n\nError: ${e.message}`
    ), 50);
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = 'Ping'; btn.style.color = ''; }, 3000);
  }
}

function emergencyStop() {
  console.error('EMERGENCY STOP TRIGGERED');
  sendDirect('protective_stop()\n');
  resetFreedriveUI();
}

function powerdownRobot() {
  if (confirm("Are you sure you want to completely power down the robot arm and controller?")) {
    sendDirect('powerdown()\n');
    resetFreedriveUI();
  }
}

async function sendToRobot() {
  resetFreedriveUI();
  const ip = document.getElementById('robot-ip').value.trim();
  if (!ip) { alert('Enter the robot IP address.'); return; }

  const warns = [];
  steps.forEach((s,i) => {
    if ((s.type==='movej'||s.type==='movel') && !s.pid)
      warns.push(`Step ${i+1} has no position set`);
  });
  if (warns.length && !confirm(`Warning:\n${warns.join('\n')}\n\nSend anyway?`)) return;

  const sendBtn   = document.getElementById('send-btn');
  const origText  = sendBtn.textContent;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  setDot('sending');

  try {
    const res  = await fetch(RELAY, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ip, code: buildCode()})
    });
    const data = await res.json();
    if (data.ok) {
      setDot('ok');
      sendBtn.textContent = '✓ Sent!';
      sendBtn.style.background  = 'var(--gn)';
      sendBtn.style.borderColor = 'var(--gn)';
      setTimeout(() => {
        sendBtn.textContent = origText;
        sendBtn.style.background  = '';
        sendBtn.style.borderColor = '';
        sendBtn.disabled = false;
      }, 2500);
    } else {
      throw new Error(data.error || 'Robot rejected the script');
    }
  } catch(e) {
    setDot('err');
    sendBtn.textContent = '✕ Failed';
    sendBtn.style.background  = 'var(--rd)';
    sendBtn.style.borderColor = 'var(--rd)';
    const isRelay = e.message.includes('fetch') || e.message.includes('Failed to fetch');
    setTimeout(() => alert(
      isRelay
        ? 'Relay server not reachable.\n\nMake sure relay.py is still running:\n  python3 relay.py'
        : `Failed to send script:\n${e.message}\n\nCheck the robot is still in Remote mode.`
    ), 50);
    setTimeout(() => {
      sendBtn.textContent = origText;
      sendBtn.style.background  = '';
      sendBtn.style.borderColor = '';
      sendBtn.disabled = false;
    }, 2500);
  }
}

// ═══════════════════════════════════════════════════════════
// LIVE JOGGING & STATE
// ═══════════════════════════════════════════════════════════
let fdAxes = [1,1,1,1,1,1];
let isFreedrive   = false;
let jogInterval   = null;
let latestJoints  = null;
let latestTcp = null;
let livePollInterval = null;

function toggleLiveMonitoring(checkbox) {
  if (checkbox.checked) {
    livePollInterval = setInterval(() => {
      const ip  = document.getElementById('robot-ip').value.trim();
      const dot = document.getElementById('robot-dot').style.background;
      if (ip && dot !== 'var(--bl)') fetchRobotState();
    }, 250);
  } else {
    clearInterval(livePollInterval);
    livePollInterval = null;
  }
}

async function fetchRobotState() {
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
      latestTcp = tcp; // Store it globally!
      // Display raw meters and radians (No degree conversion!)
      document.getElementById('live-x').innerText  = tcp[0].toFixed(4);
      document.getElementById('live-y').innerText  = tcp[1].toFixed(4);
      document.getElementById('live-z').innerText  = tcp[2].toFixed(4);
      document.getElementById('live-rx').innerText = tcp[3].toFixed(4);
      document.getElementById('live-ry').innerText = tcp[4].toFixed(4);
      document.getElementById('live-rz').innerText = tcp[5].toFixed(4);
    }

    if (joints && joints.length >= 6) {
      latestJoints = joints;
      document.getElementById('live-j0').innerText = toDisp(joints[0], true);
      document.getElementById('live-j1').innerText = toDisp(joints[1], true);
      document.getElementById('live-j2').innerText = toDisp(joints[2], true);
      document.getElementById('live-j3').innerText = toDisp(joints[3], true);
      document.getElementById('live-j4').innerText = toDisp(joints[4], true);
      document.getElementById('live-j5').innerText = toDisp(joints[5], true);
    }
  } catch(e) {
    console.error('Failed to read robot state', e);
  }
}

function recordLivePosition() {
  if (!latestJoints || !latestTcp) {
    alert("Please click '↻ Refresh' or enable Live Monitoring first to get coordinates!");
    return;
  }
  positions.push({
    id: uid(),
    name: 'POS_' + (positions.length + 1),
    j: [...latestJoints],
    c: [...latestTcp]
  });
  renderPositions(); renderSteps(); refreshCode();
}

function sendDirect(codeStr) {
  const ip = document.getElementById('robot-ip').value.trim();
  if (!ip) return;
  fetch(RELAY, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ip, code: codeStr, action:'send'})
  });
}

function toggleFdAxis(index) {
  fdAxes[index] = fdAxes[index] === 1 ? 0 : 1;
  document.getElementById(`fd-ax-${index}`).classList.toggle('on', fdAxes[index] === 1);
  if (isFreedrive) {
    sendDirect(`def fd_update():\n  freedrive_mode([${fdAxes.join(',')}], p[0,0,0,0,0,0])\n  sleep(3600)\nend\n`);
  }
}

// ═══════════════════════════════════════════════════════════
// FREEDRIVE CONTROL (Program State Detection)
// ═══════════════════════════════════════════════════════════

function toggleFreedrive() {
  const ip = document.getElementById('robot-ip').value;
  if (!ip) return alert("Enter Robot IP first.");

  isFreedrive = !isFreedrive; 
  const btn = document.getElementById('btn-freedrive');

  if (isFreedrive) {
    btn.textContent = 'Freedrive: ON';
    btn.style.background = 'var(--ac)';
    btn.style.color = '#fff';
    sendDirect(`def fd_on():\n  freedrive_mode([${fdAxes.join(',')}], p[0,0,0,0,0,0])\n  while True:\n    sync()\n  end\nend\n`);
  } else {
    // We are turning it off, strictly force the UI to update
    resetFreedriveUI();
    sendDirect(`def fd_off():\n  end_freedrive_mode()\nend\n`);
  }
}

function resetFreedriveUI() {
  // Removed the buggy "return" guard! Just strictly set it to OFF.
  isFreedrive = false;
  const btn = document.getElementById('btn-freedrive');
  if (btn) {
    btn.textContent = 'Freedrive: OFF';
    btn.style.background = 'transparent';
    btn.style.color = 'var(--ac)';
  }
}

// ── BACKGROUND DETECTION LOOP ──
function startFreedriveDetection() {
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
      // If you jog the robot, hit E-Stop, or press Stop/Pause on the pendant, 
      // the script dies. We must turn the UI button OFF to match reality.
      if (data.raw.includes("STOPPED") || data.raw.includes("PAUSED")) {
        resetFreedriveUI();
      }
    }
  })
  .finally(() => {
    setTimeout(startFreedriveDetection, 250); // Poll fast (4x a second)
  });
}

// Start the loop
startFreedriveDetection();


// ═══════════════════════════════════════════════════════════
// CARTESIAN JOGGING WITH MOUSE-HOVER GUARD
// ═══════════════════════════════════════════════════════════

// Global flag to prevent hover/drift events from triggering scripts
let isJogging = false; 

function startJog(axis, direction) {
  // Set the flag to true because a legitimate press action started
  isJogging = true; 
  
  resetFreedriveUI();

  let vector = [0, 0, 0, 0, 0, 0];
  vector[axis] = direction * (axis < 3 ? 0.05 : 0.25);

  const speedlCmd = `def jog():\n  while True:\n    speedl([${vector.join(',')}], a=0.3, t=0.1)\n  end\nend\n`;
  sendDirect(speedlCmd);
}

function stopJog() {
  // CRITICAL GUARD: If we aren't actively jogging, ignore this event completely!
  // This blocks the hover/mouseleave glitch from spamming the robot.
  if (!isJogging) return; 
  
  // Reset the flag immediately
  isJogging = false; 

  const stopCmd = "def stop_jog():\n  stopl(2.5)\nend\n";
  sendDirect(stopCmd);
}

// ═══════════════════════════════════════════════════════════
// TABS / SETTINGS
// ═══════════════════════════════════════════════════════════
function showTab(name) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  document.getElementById('tab-'+name).classList.add('on');
  event.target.classList.add('on');
}

function toggleCfg() {
  cfgOpen = !cfgOpen;
  document.getElementById('cfg-body').style.display = cfgOpen ? '' : 'none';
  document.getElementById('cfg-tog').textContent = cfgOpen ? '▼ collapse' : '▶ expand';
}

// ═══════════════════════════════════════════════════════════
// Always display joint angles in degrees in the UI; generate radians for the robot
function toDisp(rad) {
  return (rad * 180 / Math.PI).toFixed(2);
}
function fromDisp(deg) {
  return (parseFloat(deg) || 0) * Math.PI / 180;
}

// ═══════════════════════════════════════════════════════════
// POSITIONS
// ═══════════════════════════════════════════════════════════
const JOINT_LABELS = ['J0','J1','J2','J3','J4','J5'];
const CART_LABELS  = ['X','Y','Z','Rx','Ry','Rz'];

function renderPositions() {
  const el = document.getElementById('pos-list');
  el.innerHTML = positions.map(pos => {
    // Safety check — ensure both arrays always exist (handles old saved files)
    if (!pos.c) pos.c = [...pos.j];

    return `
    <div class="pos-card" id="pc-${pos.id}">
      <div class="pos-hdr">
        <div class="pos-dot ${posComplete(pos)?'full':''}" id="dot-${pos.id}"></div>
        <input class="pos-name" value="${pos.name}"
          onchange="renamePos('${pos.id}',this.value)"
          onblur="renamePos('${pos.id}',this.value)"/>
        <div class="hspace"></div>
        <button class="btn btn-sm" style="font-size:9px; padding:3px 6px;" 
          onmousedown="startMoveHere('${pos.id}')" 
          onmouseup="stopMoveHere()" 
          onmouseleave="stopMoveHere()">Move Here</button>
        <button class="btn btn-sm" style="font-size:9px; padding:3px 6px;" 
          onclick="setToCurrent('${pos.id}')">Set to Current</button>
        <button class="btn-del btn btn-sm" onclick="deletePos('${pos.id}')">✕</button>
      </div>

      <div class="pos-section-label">Joints (Degrees)</div>
      <div class="joints">
        ${JOINT_LABELS.map((name, ji) => `
          <div class="jcell">
            <div class="jlabel">${name}</div>
            <input class="jinput ${pos.j[ji] !== 0 ? 'filled' : ''}" type="number"
              step="0.1" value="${toDisp(pos.j[ji])}"
              oninput="liveJoint(this,'${pos.id}',${ji},false)"/>
          </div>
        `).join('')}
      </div>

      <div class="pos-section-label">Cartesian (Meters / Rads)</div>
      <div class="joints">
        ${CART_LABELS.map((name, ci) => `
          <div class="jcell">
            <div class="jlabel">${name}</div>
            <input class="jinput ${pos.c[ci] !== 0 ? 'filled' : ''}" type="number"
              step="0.0001" value="${pos.c[ci].toFixed(4)}"
              oninput="liveJoint(this,'${pos.id}',${ci},true)"/>
          </div>
        `).join('')}
      </div>
    </div>`;
  }).join('');
}

function posComplete(pos) {
  // Complete if it has either joint or Cartesian data
  return pos.j.some(v => v !== 0) || (pos.c && pos.c.some(v => v !== 0));
}

function liveJoint(el, pid, index, isCart) {
  el.classList.toggle('filled', el.value !== '' && el.value !== '0');
  const pos = positions.find(p => p.id === pid);
  if (!pos) return;

  if (isCart) {
    if (!pos.c) pos.c = [0,0,0,0,0,0];
    pos.c[index] = parseFloat(el.value) || 0;
  } else {
    pos.j[index] = fromDisp(el.value); // typed degrees → stored radians
  }

  document.getElementById('dot-' + pid).className = 'pos-dot' + (posComplete(pos) ? ' full' : '');
  refreshCode();
}

function renamePos(pid, val) {
  const pos = positions.find(p=>p.id===pid); if (!pos) return;
  pos.name = val.toUpperCase().replace(/\s+/g,'_').replace(/[^A-Z0-9_]/g,'') || pos.name;
  refreshCode(); renderSteps();
}

function addPos() {
  positions.push({id:uid(), name:'POS_'+(positions.length+1), j:[0,0,0,0,0,0], c:[0,0,0,0,0,0]});
  renderPositions(); renderSteps(); refreshCode();
}

function deletePos(pid) {
  if (positions.length<=1) return;
  positions = positions.filter(p=>p.id!==pid);
  steps = steps.map(s=>{
    if ((s.type==='movej'||s.type==='movel')&&s.pid===pid) return {...s, pid:null};
    if (s.type==='movec'&&s.via===pid) return {...s, via:null};
    if (s.type==='movec'&&s.to===pid)  return {...s, to:null};
    return s;
  });
  renderPositions(); renderSteps(); refreshCode();
}

// ═══════════════════════════════════════════════════════════
// NEW: QUICK ACTION BUTTONS (MOVE HERE & SET TO CURRENT)
// ═══════════════════════════════════════════════════════════

function startMoveHere(pid) {
  const pos = positions.find(p => p.id === pid);
  if (!pos || !pos.c) return;

  // Grab the global linear speed/accel from the Settings panel for safety
  const ls = parseFloat(document.getElementById('ls').value) || 0.25;
  const la = parseFloat(document.getElementById('la').value) || 1.2;

  // Generate a Cartesian move command (movel)
  const cartStr = pos.c.map(v => v.toFixed(4)).join(',');
  const urscript = `def move_here():\n  movej(p[${cartStr}], a=${la}, v=${ls})\nend\n`;
  
  resetFreedriveUI();
  sendDirect(urscript);

}

function stopMoveHere() {
  // Gracefully stop the robot if the user releases the mouse button early
  sendDirect("def stop_move():\n  stopl(2.5)\nend\n");
}

function setToCurrent(pid) {
  // Ensure we actually have live telemetry to pull from
  if (!latestJoints || !latestTcp) {
    alert("Please enable the 'Live Tracker' or click '↻ Refresh' first to get the robot's current coordinates.");
    return;
  }

  const pos = positions.find(p => p.id === pid);
  if (!pos) return;

  // Update the position object with the live global arrays
  pos.j = [...latestJoints];
  pos.c = [...latestTcp];

  // Re-render the UI and code block to reflect changes
  renderPositions();
  renderSteps();
  refreshCode();
}

// ═══════════════════════════════════════════════════════════
// STEP DEPTHS
// ═══════════════════════════════════════════════════════════
const OPENERS = ['loop_n','loop_forever','loop_while','if_din'];

function computeDepths() {
  const depths=[], opens=[];
  steps.forEach(s=>{
    if (s.type==='block_end') {
      opens.pop();
      depths.push(opens.length);
    } else if (s.type==='else_block') {
      depths.push(opens.length>0 ? opens.length-1 : 0);
    } else {
      depths.push(opens.length);
      if (OPENERS.includes(s.type)) opens.push(opens.length);
    }
  });
  return depths;
}

// ═══════════════════════════════════════════════════════════
// STEP RENDERING
// ═══════════════════════════════════════════════════════════
const TAG_INFO = {
  movej:            ['MOVEJ','tag-move'],
  movel:            ['MOVEL','tag-move'],
  movec:            ['MOVEC','tag-move'],
  open_gripper:     ['GRIP', 'tag-grip'],
  close_gripper:    ['GRIP', 'tag-grip'],
  activate_gripper: ['GRIP', 'tag-grip'],
  read_gripper: ['GRIP?', 'tag-util'],
  sleep:            ['WAIT', 'tag-util'],
  textmsg:          ['LOG',  'tag-util'],
  popup:            ['POP',  'tag-util'],
  set_digital_out:  ['DOUT', 'tag-util'],
  set_payload:      ['LOAD', 'tag-util'],
  set_tcp:          ['TCP',  'tag-util'],
  loop_start:   ['LOOP', 'tag-logic'],
  if_start:     ['IF', 'tag-logic'],
  else:         ['ELSE', 'tag-logic'],
  wait_cond:    ['WAIT', 'tag-logic'],
  halt:         ['HALT', 'tag-logic'],
  thread_start: ['THRD', 'tag-logic'],
  end:          ['END', 'tag-logic'],
  assign:       ['VAR', 'tag-util'],
  timer:        ['TIME', 'tag-util'],
  comment:      ['//', 'tag-util'],
  folder:       ['FLDR', 'tag-util'],
};

function stepParams(s) {
  const si = `'${s.id}'`;
  switch(s.type) {
    case 'movej':
      return `<select class="step-sel" onchange="upd(${si},'pid',this.value)">${
        positions.map(p=>`<option value="${p.id}" ${s.pid===p.id?'selected':''}>${p.name}</option>`).join('')
      }</select>`;
    case 'movel': {
      return `<select class="step-sel" onchange="upd(${si},'pid',this.value)">${
        positions.map(p=>`<option value="${p.id}" ${s.pid===p.id?'selected':''}>${p.name}</option>`).join('')
      }</select>`;
    }
    case 'movec': {
      const mk  = sel => positions.map(p=>`<option value="${p.id}" ${sel===p.id?'selected':''}>${p.name}</option>`).join('');
      return `<span style="font-size:10px;color:var(--tx3)">via</span>
        <select class="step-sel" onchange="upd(${si},'via',this.value)">${mk(s.via)}</select>
        <span style="font-size:10px;color:var(--tx3)">to</span>
        <select class="step-sel" onchange="upd(${si},'to',this.value)">${mk(s.to)}</select>`;
    }
    case 'sleep':
      return `<input class="step-inp" type="number" min="0" step="0.1" value="${s.sec??1}" style="width:60px"
              oninput="upd(${si},'sec',+this.value)">
              <span style="font-size:10px;color:var(--tx3)">sec</span>`;
    case 'textmsg':
    case 'popup':
      return `<input class="step-inp" type="text" value="${esc(s.msg??'')}" style="width:200px"
        placeholder="${s.type==='popup'?'Pendant message...':'Log message...'}"
        oninput="upd(${si},'msg',this.value)">`;
    case 'set_digital_out':
      return `<span style="font-size:10px;color:var(--tx3)">D.OUT</span>
        <input class="step-inp" type="number" min="0" max="15" value="${s.port??0}" style="width:44px"
          oninput="upd(${si},'port',+this.value)">
        <select class="step-sel" onchange="upd(${si},'val',this.value==='true')">
          <option value="true"  ${s.val!==false?'selected':''}>HIGH</option>
          <option value="false" ${s.val===false ?'selected':''}>LOW</option>
        </select>`;
    case 'set_payload':
      return `<input class="step-inp" type="number" step="0.1" min="0" value="${s.weight??0}" style="width:60px"
              oninput="upd(${si},'weight',+this.value)">
              <span style="font-size:10px;color:var(--tx3)">kg</span>`;
    case 'set_tcp':
      return `<input class="step-inp" type="text" value="${s.pose??'0,0,0,0,0,0'}" style="width:160px"
        placeholder="x,y,z,rx,ry,rz" oninput="upd(${si},'pose',this.value)">`;
    default: return '';

    // ── Logic Blocks ──
    case 'loop_start':
      return `<select class="step-inp" onchange="upd(${si},'loopType',this.value)">
                <option value="forever" ${s.loopType==='forever'?'selected':''}>Forever</option>
                <option value="times" ${s.loopType==='times'?'selected':''}>Times</option>
              </select>
              ${s.loopType==='times' ? `<input class="step-inp" type="number" value="${s.loopCount}" style="width:50px" oninput="upd(${si},'loopCount',this.value)">` : ''}`;
    case 'if_start':
    case 'wait_cond':
      return `Cond: <input class="step-inp" type="text" value="${s.condition}" style="width:140px" placeholder="e.g. get_digital_in(1)" oninput="upd(${si},'condition',this.value)">`;
    case 'thread_start':
      return `Name: <input class="step-inp" type="text" value="${s.threadName}" style="width:100px" oninput="upd(${si},'threadName',this.value)">`;
    
    // ── Variables & Utils ──
    case 'read_gripper':
      return `Save pos to: <input class="step-inp" type="text" value="${s.varName}" style="width:100px" oninput="upd(${si},'varName',this.value)">`;
    case 'assign':
      return `<input class="step-inp" type="text" value="${s.varName}" style="width:70px" oninput="upd(${si},'varName',this.value)"> =
              <input class="step-inp" type="text" value="${s.varValue}" style="width:90px" oninput="upd(${si},'varValue',this.value)">`;
    case 'timer':
      return `<select class="step-inp" onchange="upd(${si},'timerAct',this.value)">
                <option value="start" ${s.timerAct==='start'?'selected':''}>Start</option>
                <option value="read" ${s.timerAct==='read'?'selected':''}>Read to Var</option>
              </select>
              <input class="step-inp" type="text" value="${s.timerVar}" style="width:80px" oninput="upd(${si},'timerVar',this.value)">`;
    case 'popup':
      return `Msg: <input class="step-inp" type="text" value="${s.msg}" style="width:90px" oninput="upd(${si},'msg',this.value)">
              Type: <select class="step-inp" onchange="upd(${si},'pType',this.value)">
                <option value="msg" ${s.pType==='msg'?'selected':''}>Message</option>
                <option value="warn" ${s.pType==='warn'?'selected':''}>Warning</option>
                <option value="err" ${s.pType==='err'?'selected':''}>Error</option>
              </select>`;
    case 'folder':
      return `📁 <input class="step-inp" type="text" value="${s.folderName}" style="width:130px" oninput="upd(${si},'folderName',this.value)">`;
    case 'comment':
      return `// <input class="step-inp" type="text" value="${s.commentTxt}" style="width:150px" oninput="upd(${si},'commentTxt',this.value)">`;
    case 'halt':
    case 'else':
    case 'end':
      return `<span style="font-size:10px;color:var(--tx3)">No parameters needed.</span>`;
  }
}

function renderSteps() {
  const depths = computeDepths();
  const list   = document.getElementById('steps-list');
  list.innerHTML = steps.map((s,si)=>{
    const [tag,tagCls] = TAG_INFO[s.type] || ['?','tag-util'];
    const depth    = depths[si];
    const indent   = Array(depth).fill('<div class="step-indent-line"></div>').join('');
    const extraCls = OPENERS.includes(s.type) ? 'block-open'
                   : s.type==='block_end'      ? 'block-end-row'
                   : s.type==='else_block'      ? 'else-row' : '';
    return `<div class="step-row">
      <div class="step-indent">${indent}</div>
      <div class="step ${extraCls}" id="st-${s.id}">
        <span class="step-n">${si+1}</span>
        <span class="step-tag ${tagCls}">${tag}</span>
        <select class="step-sel" onchange="changeType('${s.id}',this.value)" style="font-size:10px;max-width:100px">
          ${Object.entries(TAG_INFO).map(([v])=>`<option value="${v}" ${s.type===v?'selected':''}>${v}</option>`).join('')}
        </select>
        ${stepParams(s)}
        <span class="step-spacer"></span>
        <div class="step-controls">
          <button class="btn-ghost btn btn-sm" onclick="moveStep('${s.id}',-1)" ${si===0?'disabled':''}>↑</button>
          <button class="btn-ghost btn btn-sm" onclick="moveStep('${s.id}',1)" ${si===steps.length-1?'disabled':''}>↓</button>
          <button class="btn-del btn btn-sm" onclick="deleteStep('${s.id}')">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('step-count').textContent = steps.length+' step'+(steps.length!==1?'s':'');
  validateSteps();
}

function validateSteps() {
  const warns = [];
  steps.forEach((s,i)=>{
    if (s.type==='movel') {
      const pos = positions.find(p=>p.id===s.pid);
      if (!pos) warns.push(`Step ${i+1}: movel has no position set`);
    }
    if (s.type==='movec') {
      const via=positions.find(p=>p.id===s.via), to=positions.find(p=>p.id===s.to);
      if (!via||!to) warns.push(`Step ${i+1}: movec needs Via and To positions`);
    }
    if (s.type==='movej'&&!s.pid) warns.push(`Step ${i+1}: movej has no position set`);
  });
  let depth=0;
  steps.forEach((s,i)=>{
    if (OPENERS.includes(s.type)) depth++;
    else if (s.type==='block_end') {
      depth--;
      if (depth<0) { warns.push(`Step ${i+1}: END has no matching opener`); depth=0; }
    }
  });
  if (depth>0) warns.push(`${depth} block(s) not closed — add End block`);
  const wb = document.getElementById('warn-box');
  if (warns.length) { wb.className='warn-box show'; wb.innerHTML='⚠ '+warns.join('<br>⚠ '); }
  else wb.className='warn-box';
}

// ═══════════════════════════════════════════════════════════
// STEP MUTATIONS
// ═══════════════════════════════════════════════════════════
function defaultStep(type) {
  const s = {id:uid(), type};
  if (type==='movej') s.pid = positions.find(p=>p.type==='joint')?.id ?? positions[0]?.id ?? null;
  if (type==='movel') s.pid = positions.find(p=>p.type==='cart')?.id ?? null;
  if (type==='movec') { s.via = positions.find(p=>p.type==='cart')?.id ?? null; s.to = s.via; }
  if (type==='sleep') s.sec = 1;
  if (type==='textmsg'||type==='popup') s.msg = '';
  if (type==='set_digital_out') { s.port=0; s.val=true; }
  if (type==='set_payload') s.weight = 0.5;
  if (type==='set_tcp') s.pose = '0,0,0,0,0,0';
  if (type==='loop_start') { s.loopType = 'forever'; s.loopCount = 5; }
  if (type==='if_start') { s.condition = 'get_digital_in(1) == True'; }
  if (type==='read_gripper') s.varName = 'part_size';
  if (type==='wait_cond') { s.condition = 'get_digital_in(1) == True'; }
  if (type==='assign') { s.varName = 'my_var'; s.varValue = '0'; }
  if (type==='timer') { s.timerAct = 'start'; s.timerVar = 'timer_1'; }
  if (type==='thread_start') { s.threadName = 'thread_1'; }
  if (type==='folder') { s.folderName = 'My Folder'; }
  if (type==='comment') { s.commentTxt = 'Note here'; }
  
  // Make sure your popup has the updated properties
  if (type==='popup') { s.msg = 'Hello'; s.pType = 'msg'; }
  return s;
}

function addStep()    { steps.push(defaultStep(document.getElementById('new-type').value)); renderSteps(); refreshCode(); }
function deleteStep(sid) { steps=steps.filter(s=>s.id!==sid); renderSteps(); refreshCode(); }
function moveStep(sid,dir) {
  const i=steps.findIndex(s=>s.id===sid), j=i+dir;
  if (j<0||j>=steps.length) return;
  [steps[i],steps[j]]=[steps[j],steps[i]];
  renderSteps(); refreshCode();
}
function changeType(sid,type) {
  const i=steps.findIndex(s=>s.id===sid); if (i<0) return;
  steps[i]={...defaultStep(type), id:sid};
  renderSteps(); refreshCode();
}
function upd(sid,key,val) {
  const s=steps.find(x=>x.id===sid);
  if (s) { s[key]=val; refreshCode(); validateSteps(); }
}

// ═══════════════════════════════════════════════════════════
// CODE GENERATION
// ═══════════════════════════════════════════════════════════
function gv(id) { return parseFloat(document.getElementById(id)?.value)||0; }
function poseStr(pos, moveType) {
  if (moveType === 'movel' || moveType === 'movec') {
    // Linear/circular moves use Cartesian data
    const cart = pos.c && pos.c.some(v=>v!==0) ? pos.c : pos.j;
    return `p[${cart.map(v=>v.toFixed(4)).join(', ')}]`;
  }
  // movej and all others use joint angles (radians)
  return `[${pos.j.map(v=>v.toFixed(4)).join(', ')}]`;
}

function buildCode() {
  const T  = '    ';
  const js=gv('js'), ja=gv('ja'), ls=gv('ls'), la=gv('la'), br=gv('br');
  const tcx=gv('tcp-x'), tcy=gv('tcp-y'), tcz=gv('tcp-z');
  const tcrx=gv('tcp-rx'), tcry=gv('tcp-ry'), tcrz=gv('tcp-rz');
  const plw=gv('pl-w'), plx=gv('pl-x'), ply=gv('pl-y'), plz=gv('pl-z');
  const isTCPSet = tcx||tcy||tcz||tcrx||tcry||tcrz;
  const L = [];

  L.push('def master_program():');
  L.push(`${T}# Motion parameters`);
  L.push(`${T}global JOINT_SPEED  = ${js}`);
  L.push(`${T}global JOINT_ACCEL  = ${ja}`);
  L.push(`${T}global LINEAR_SPEED = ${ls}`);
  L.push(`${T}global LINEAR_ACCEL = ${la}`);
  L.push(`${T}global BLEND_RADIUS = ${br}`);
  L.push('');
  L.push(`${T}# Positions`);
  positions.forEach(pos => {
    L.push(`${T}global ${pos.name}_J = [${pos.j.map(v=>v.toFixed(4)).join(', ')}]`);
    const cart = pos.c && pos.c.some(v=>v!==0) ? pos.c : pos.j;
    L.push(`${T}global ${pos.name}_C = p[${cart.map(v=>v.toFixed(4)).join(', ')}]`);
  });
  L.push('');
  L.push(`${T}# Setup`);
  if (isTCPSet) L.push(`${T}set_tcp(p[${tcx},${tcy},${tcz},${tcrx},${tcry},${tcrz}])`);
  L.push(`${T}set_payload(${plw}, [${plx}, ${ply}, ${plz}])`);
  L.push('');
  L.push(`${T}# Gripper init`);
  
  // 1. ZOMBIE SOCKET KILLER: Force close any hanging connections from previous runs
  L.push(`${T}socket_close("rq_srv")`);
  L.push(`${T}socket_open("127.0.0.1", 63352, "rq_srv")`);
  
  // 2. VALID ACTIVATION SEQUENCE
  L.push(`${T}socket_send_string("SET ACT 1", "rq_srv")`);
  L.push(`${T}socket_send_byte(10, "rq_srv")`);
  L.push(`${T}sync()`);
  L.push(`${T}socket_send_string("SET GTO 1", "rq_srv")`);
  L.push(`${T}socket_send_byte(10, "rq_srv")`);
  L.push(`${T}sync()`);
  
  // 3. INCREASED TIMEOUT: Wait 3 seconds for the physical fingers to calibrate
  L.push(`${T}sleep(3.0)`);
  L.push('');
  L.push('');
  L.push(`${T}# Main sequence`);

  // ── NEW STACK-BASED COMPILER ──
  let ind = 1;
  let stack = []; 
  const getTab = () => T.repeat(ind);

  steps.forEach((s, si) => {
    
    // 1. Pre-indent handlers (Outdent FIRST if we hit an end or else)
    if (s.type === 'end' || s.type === 'block_end') {
      ind = Math.max(1, ind - 1);
      let tab = getTab();
      let parent = stack.pop() || { type: 'unknown' };
      
      if (parent.type === 'folder') {
        L.push(`${tab}# └ End ${parent.folderName}`);
      } 
      else if (parent.type === 'loop_start' && parent.loopType === 'times') {
        L.push(`${tab}loop_var_${parent._si} = loop_var_${parent._si} + 1`);
        L.push(`${tab}end`);
      }
      else if (parent.type === 'loop_n') { // Legacy support
        L.push(`${tab}${parent._cvar} = ${parent._cvar} + 1`);
        L.push(`${tab}end`);
      }
      else if (parent.type === 'thread_start') {
        L.push(`${tab}end`);
        L.push(`${tab}run ${parent.threadName}()`);
      } 
      else {
        L.push(`${tab}end`);
      }
      return; 
    }

    if (s.type === 'else' || s.type === 'else_block') {
      ind = Math.max(1, ind - 1);
      L.push(`${getTab()}else:`);
      ind++; 
      return; 
    }

    let tab = getTab();

    // 2. Compile commands
    switch(s.type) {
      
      // ── MOTION BLOCKS ──
      case 'movej': {
        const p = positions.find(x=>x.id===s.pid);
        L.push(`${tab}movej(${p?p.name+'_J':'UNKNOWN'}, a=JOINT_ACCEL, v=JOINT_SPEED, r=BLEND_RADIUS)`);
        break;
      }
      case 'movel': {
        const p = positions.find(x=>x.id===s.pid);
        L.push(`${tab}movel(${p?p.name+'_C':'UNKNOWN'}, a=LINEAR_ACCEL, v=LINEAR_SPEED, r=BLEND_RADIUS)`);
        break;
      }
      case 'movec': {
        const v=positions.find(x=>x.id===s.via), t=positions.find(x=>x.id===s.to);
        L.push(`${tab}movec(${v?v.name+'_C':'UNKNOWN'}, ${t?t.name+'_C':'UNKNOWN'}, a=LINEAR_ACCEL, v=LINEAR_SPEED)`);
        break;
      }

      // ── GRIPPER BLOCKS ──
      case 'activate_gripper':
        L.push(`${tab}socket_send_string("SET ACT 1", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_dump = socket_read_string("rq_srv", timeout=0.1)`);
        
        L.push(`${tab}socket_send_string("SET GTO 1", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_dump = socket_read_string("rq_srv", timeout=0.1)`);
        
        L.push(`${tab}_sta = 0`);
        // Loop until STA is 3 (Activation Complete)
        L.push(`${tab}while (_sta != 3):`);
        L.push(`${tab}${T}socket_send_string("GET STA", "rq_srv")`);
        L.push(`${tab}${T}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}${T}_raw = socket_read_string("rq_srv", timeout=0.1)`);
        L.push(`${tab}${T}# Slice "STA 3" -> "3" and convert to number`);
        L.push(`${tab}${T}_sta = to_num(str_sub(_raw, 4, 1))`);
        L.push(`${tab}${T}sync()`);
        L.push(`${tab}end`);
        L.push(`${tab}textmsg("GRIPPER:ACTIVATED")`);
        break;

      case 'open_gripper':
        L.push(`${tab}socket_send_string("SET SPE 255", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_dump = socket_read_string("rq_srv", timeout=0.1)`);
        
        L.push(`${tab}socket_send_string("SET FOR 255", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_dump = socket_read_string("rq_srv", timeout=0.1)`);
        
        L.push(`${tab}socket_send_string("SET POS 0", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_dump = socket_read_string("rq_srv", timeout=0.1)`);
        
        L.push(`${tab}_obj = 0`);
        // Loop until OBJ is 1, 2, or 3 (Motion finished)
        L.push(`${tab}while (_obj != 1 and _obj != 2 and _obj != 3):`);
        L.push(`${tab}${T}socket_send_string("GET OBJ", "rq_srv")`);
        L.push(`${tab}${T}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}${T}_raw = socket_read_string("rq_srv", timeout=0.1)`);
        L.push(`${tab}${T}_obj = to_num(str_sub(_raw, 4, 1))`);
        L.push(`${tab}${T}sync()`);
        L.push(`${tab}end`);
        L.push(`${tab}textmsg("GRIPPER:OPEN")`);
        break;

      case 'close_gripper':
        L.push(`${tab}socket_send_string("SET SPE 255", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_dump = socket_read_string("rq_srv", timeout=0.1)`);
        
        L.push(`${tab}socket_send_string("SET FOR 255", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_dump = socket_read_string("rq_srv", timeout=0.1)`);
        
        L.push(`${tab}socket_send_string("SET POS 255", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_dump = socket_read_string("rq_srv", timeout=0.1)`);
        
        L.push(`${tab}_obj = 0`);
        // Loop until OBJ is 1, 2, or 3 (Contact or finished)
        L.push(`${tab}while (_obj != 1 and _obj != 2 and _obj != 3):`);
        L.push(`${tab}${T}socket_send_string("GET OBJ", "rq_srv")`);
        L.push(`${tab}${T}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}${T}_raw = socket_read_string("rq_srv", timeout=0.1)`);
        L.push(`${tab}${T}_obj = to_num(str_sub(_raw, 4, 1))`);
        L.push(`${tab}${T}sync()`);
        L.push(`${tab}end`);
        L.push(`${tab}textmsg("GRIPPER:CLOSE")`);
        break;

      case 'read_gripper':
        L.push(`${tab}socket_send_string("GET POS", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}_raw = socket_read_string("rq_srv", timeout=0.1)`);
        L.push(`${tab}# Slice "POS 125" -> "125" and convert to number`);
        L.push(`${tab}${s.varName ?? 'part_size'} = to_num(str_sub(_raw, 4, 3))`);
        break;      

      // ── NEW LOGIC CONTAINERS ──
      case 'loop_start':
        if (s.loopType === 'times') {
          s._si = si; 
          L.push(`${tab}loop_var_${si} = 0`);
          L.push(`${tab}while (loop_var_${si} < ${s.loopCount}):`);
        } else {
          L.push(`${tab}while True:`);
        }
        stack.push(s);
        ind++;
        break;

      case 'if_start':
        L.push(`${tab}if (${s.condition}):`);
        stack.push(s);
        ind++;
        break;

      case 'thread_start':
        L.push(`${tab}thread ${s.threadName}():`);
        stack.push(s);
        ind++;
        break;

      case 'folder':
        L.push(`${tab}# 📂 ${s.folderName}`);
        stack.push(s);
        ind++;
        break;

      // ── FLAT LOGIC ──
      case 'wait_cond':
        L.push(`${tab}while not (${s.condition}):`);
        L.push(`${tab}${T}sync()`);
        L.push(`${tab}end`);
        break;

      case 'halt':
        L.push(`${tab}halt`);
        break;

      case 'assign':
        L.push(`${tab}${s.varName} = ${s.varValue}`);
        break;

      case 'timer':
        if (s.timerAct === 'start') {
          L.push(`${tab}${s.timerVar}_start = get_system_time()`);
        } else {
          L.push(`${tab}${s.timerVar} = get_system_time() - ${s.timerVar}_start`);
        }
        break;

      // ── UTILITIES ──
      case 'sleep':           
        L.push(`${tab}sleep(${s.time ?? s.sec ?? 1.0})`); 
        break;
      case 'textmsg':         
        L.push(`${tab}textmsg("${s.msg ?? 'Log'}")`); 
        break;
      case 'popup':           
        let w = s.pType === 'warn' ? 'True' : 'False';
        let e = s.pType === 'err' ? 'True' : 'False';
        L.push(`${tab}popup("${s.msg ?? ''}", title="UI", warning=${w}, error=${e}, blocking=True)`); 
        break;
      case 'set_digital_out': 
        let val = (s.outVal === 'high' || s.val !== false) ? 'True' : 'False';
        L.push(`${tab}set_digital_out(${s.port??0}, ${val})`); 
        break;
      case 'set_payload':     
        L.push(`${tab}set_payload(${s.weight ?? s.plw ?? 0})`); 
        break;
      case 'set_tcp':         
        L.push(`${tab}set_tcp(p[${s.pose ?? '0,0,0,0,0,0'}])`); 
        break;
      case 'comment':
        L.push(`${tab}# ${s.commentTxt ?? ''}`);
        break;
    }
  });

  L.push(`${T}socket_close("rq_srv")`);
  L.push(`${T}textmsg("=== Program Complete ===")`);
  L.push('end');
  L.push('master_program()');
  return L.join('\n') + '\n';
}

function findMatchingLoopCounter(endStep) {
  const ei = steps.indexOf(endStep);
  let depth = 0;
  for (let i=ei; i>=0; i--) {
    const s = steps[i];
    if (s.type==='block_end'&&i!==ei) depth++;
    else if (OPENERS.includes(s.type)) {
      if (depth===0) {
        if (s.type==='loop_n') {
          let n=0;
          for (let j=0; j<i; j++) if (steps[j].type==='loop_n') n++;
          return `_i${n}`;
        }
        return null;
      }
      depth--;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// SYNTAX HIGHLIGHT
// ═══════════════════════════════════════════════════════════
const KW  = /\b(def|end|if|else|elif|while|global|return|True|False|not|and|or)\b/g;
const FNS = /\b(movej|movel|movec|sleep|textmsg|popup|set_tcp|set_payload|set_digital_out|get_digital_in|socket_open|socket_close|socket_send_string|socket_send_byte|sync|speedl|stopl|freedrive_mode|end_freedrive_mode|master_program)\b/g;
const NUM = /(?<!["'\w])(-?\d+\.?\d*)\b/g;

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function highlight(code) {
  return code.split('\n').map(line=>{
    const e = esc(line);
    if (/^\s*#/.test(e)) return `<span class="c-cm">${e}</span>`;
    let c=e, cm='';
    const ci = e.indexOf('#');
    if (ci>0) { c=e.slice(0,ci); cm=e.slice(ci); }
    const sm={}; let si=0;
    c = c.replace(/"([^"]*)"/g, (_,inner)=>{
      const k=`\x00${si++}\x00`;
      sm[k]=`<span class="c-str">"${inner}"</span>`;
      return k;
    });
    c = c.replace(NUM, m=>`<span class="c-num">${m}</span>`)
         .replace(KW,  m=>`<span class="c-kw">${m}</span>`)
         .replace(FNS, m=>`<span class="c-fn">${m}</span>`);
    Object.entries(sm).forEach(([k,v])=>{ c=c.replace(k,v); });
    if (cm) c += `<span class="c-cm">${esc(cm)}</span>`;
    return c;
  }).join('\n');
}

function refreshCode() {
  const plain = buildCode();
  document.getElementById('code-out').innerHTML = highlight(plain);
  document.getElementById('code-lines').textContent = plain.split('\n').length+' lines';
}

// ═══════════════════════════════════════════════════════════
// COPY / DOWNLOAD / SAVE / LOAD
// ═══════════════════════════════════════════════════════════
function copyCode() {
  navigator.clipboard.writeText(buildCode()).then(()=>{
    const b = document.querySelector('.hdr .btn');
    const o = b.textContent;
    b.textContent = '✓ Copied!';
    setTimeout(()=>b.textContent=o, 1800);
  });
}

function downloadCode() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buildCode()], {type:'text/plain'}));
  a.download = 'ur3e_program.script';
  a.click();
}

function exportProject() {
  const projectData = {
    positions,
    steps,
    settings: {
      js: document.getElementById('js').value,
      ja: document.getElementById('ja').value,
      ls: document.getElementById('ls').value,
      la: document.getElementById('la').value,
    }
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(projectData, null, 2)], {type:'application/json'}));
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
      
      // 1. Restore positions
      if (data.positions) {
        positions = data.positions;
      }
      
      // 2. Restore steps & FIX THE ID GLITCH
      if (data.steps) {
        steps = data.steps;
        
        // Loop through every imported step and give it an ID if it's missing one
        steps.forEach(s => {
          if (!s.id) {
            s.id = uid(); // Uses your existing unique ID generator!
          }
        });
      }
      
      // 3. Re-render the UI
      renderPositions();
      renderSteps();
      buildCode();
      
    } catch (err) {
      alert("Error loading project: " + err);
    }
  };
  
  reader.readAsText(file);
  input.value = ''; // Resets the file input so you can load the same file again if needed
}

// ═══════════════════════════════════════════════════════════
// LIVE GRIPPER TELEMETRY (BACKGROUND LOOP)
// ═══════════════════════════════════════════════════════════

function startGripperTelemetry() {
  const posEl = document.getElementById('live-gripper-pos');
  const objEl = document.getElementById('live-gripper-obj');
  const ip = document.getElementById('robot-ip').value;
  
  if (!ip) {
    setTimeout(startGripperTelemetry, 1000);
    return;
  }

  fetch(RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'gripper_status', ip: ip })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      let raw = data.position_raw;
      
      // Clamp values to your hardware limits (3 to 230)
      if (raw < 3) raw = 3;
      if (raw > 230) raw = 230;
      
      // Map to 0-100%
      let pct = Math.round(((raw - 3) / (230 - 3)) * 100);
      posEl.innerText = `${raw} (${pct}%)`;

      // Show "OBJ" if gOBJ is 1 (inner grasp) or 2 (outer grasp)
      if (data.gobj === 1 || data.gobj === 2) {
        objEl.style.display = 'inline'; // Smooth text flow next to position
      } else {
        objEl.style.display = 'none';   // Hide completely when empty-handed
      }
    }
  })
  .catch(err => {
    posEl.innerText = "---";
    objEl.style.display = 'none'; // Clear the indicator on network drops
  })
  .finally(() => {
    // Poll every 100ms
    setTimeout(startGripperTelemetry, 100);
  });
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
initSteps();
renderPositions();
renderSteps();
refreshCode();
startGripperTelemetry();
startStateDetection();