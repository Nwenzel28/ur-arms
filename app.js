// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let mode = 'deg';
let cfgOpen = true;
let _uid = 0;
const uid = () => 'u' + (_uid++);

let positions = [
  {id:uid(), name:'HOME',     type:'joint', j:[0,-1.5708,0,-1.5708,-1.5708,0]},
  {id:uid(), name:'APPROACH', type:'joint', j:[0,-1.5708,0,-1.5708,-1.5708,0]},
  {id:uid(), name:'PICK',     type:'joint', j:[0,-1.5708,0,-1.5708,-1.5708,0]},
  {id:uid(), name:'PLACE',    type:'joint', j:[0,-1.5708,0,-1.5708,-1.5708,0]},
];

let steps = [];

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
    idle:    {bg:'var(--tx3)',  shadow:'none',              send:false},
    pinging: {bg:'var(--yl,#f59e0b)', shadow:'none',       send:false},
    ok:      {bg:'var(--gn)',   shadow:'0 0 7px var(--gn)', send:true},
    err:     {bg:'var(--rd)',   shadow:'none',              send:false},
    sending: {bg:'var(--bl)',   shadow:'0 0 7px var(--bl)', send:false},
  };
  const cfg = map[state] || map.idle;
  dot.style.background  = cfg.bg;
  dot.style.boxShadow   = cfg.shadow;
  sendBtn.disabled      = !cfg.send;
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

async function sendToRobot() {
  const ip = document.getElementById('robot-ip').value.trim();
  if (!ip) { alert('Enter the robot IP address.'); return; }
  const warns = [];
  steps.forEach((s,i) => {
    if ((s.type==='movej'||s.type==='movel') && !s.pid) warns.push(`Step ${i+1} has no position set`);
  });
  if (warns.length && !confirm(`Warning:\n${warns.join('\n')}\n\nSend anyway?`)) return;

  const sendBtn = document.getElementById('send-btn');
  const origText = sendBtn.textContent;
  sendBtn.disabled = true;
  sendBtn.textContent = '⏳ Sending…';
  setDot('sending');
  try {
    const res = await fetch(RELAY, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ip, code: buildCode()})
    });
    const data = await res.json();
    if (data.ok) {
      setDot('ok');
      sendBtn.textContent = '✓ Sent!';
      sendBtn.style.background = 'var(--gn)';
      sendBtn.style.borderColor = 'var(--gn)';
      setTimeout(() => {
        sendBtn.textContent = origText;
        sendBtn.style.background = '';
        sendBtn.style.borderColor = '';
        sendBtn.disabled = false;
      }, 2500);
    } else {
      throw new Error(data.error || 'Robot rejected the script');
    }
  } catch(e) {
    setDot('err');
    sendBtn.textContent = '✕ Failed';
    sendBtn.style.background = 'var(--rd)';
    sendBtn.style.borderColor = 'var(--rd)';
    const isRelay = e.message.includes('fetch') || e.message.includes('Failed to fetch');
    setTimeout(() => alert(
      isRelay 
        ? 'Relay server not reachable.\n\nMake sure relay.py is still running:\n  python3 relay.py'
        : `Failed to send script:\n${e.message}\n\nCheck the robot is still in Remote mode.`
    ), 50);
    setTimeout(() => {
      sendBtn.textContent = origText;
      sendBtn.style.background = '';
      sendBtn.style.borderColor = '';
      sendBtn.disabled = false;
    }, 2500);
  }
}

// ═══════════════════════════════════════════════════════════
// LIVE JOGGING & STATE
// ═══════════════════════════════════════════════════════════
let fdAxes = [1, 1, 1, 1, 1, 1];
let isFreedrive = false;
let jogInterval = null;
let latestJoints = null; 

async function fetchRobotState() {
  const ip = document.getElementById('robot-ip').value.trim();
  if(!ip) return;
  try {
    const res = await fetch(RELAY, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ip: ip, action: 'state'})
    });
    const data = await res.json();
    
    console.log("ROBOT DATA RECEIVED:", data);
    
    const tcp = data.tcp || data.actual_TCP_pose || data.pose || data.cartesian;
    const joints = data.joints || data.actual_joint_positions || data.q_actual || data.q;
    
    if (tcp && tcp.length >= 6) {
      document.getElementById('live-x').innerText = toDisp(tcp[0], false);
      document.getElementById('live-y').innerText = toDisp(tcp[1], false);
      document.getElementById('live-z').innerText = toDisp(tcp[2], false);
      document.getElementById('live-rx').innerText = toDisp(tcp[3], true);
      document.getElementById('live-ry').innerText = toDisp(tcp[4], true);
      document.getElementById('live-rz').innerText = toDisp(tcp[5], true);
    } else {
      console.warn("Could not find TCP data in the response.");
    }
    
    if (joints && joints.length >= 6) {
      latestJoints = joints; 
      document.getElementById('live-j0').innerText = toDisp(joints[0], true);
      document.getElementById('live-j1').innerText = toDisp(joints[1], true);
      document.getElementById('live-j2').innerText = toDisp(joints[2], true);
      document.getElementById('live-j3').innerText = toDisp(joints[3], true);
      document.getElementById('live-j4').innerText = toDisp(joints[4], true);
      document.getElementById('live-j5').innerText = toDisp(joints[5], true);
    } else {
      console.warn("Could not find Joint data in the response.");
    }
  } catch(e) {
    console.error("Failed to read robot state", e);
  }
}

function recordLivePosition() {
  if (!latestJoints) {
    alert("No live robot position data acquired yet.\nPress ↻ Refresh or connect to a robot stream first.");
    return;
  }
  const name = prompt("Enter name for recorded position:", `WP_${positions.length + 1}`);
  if (!name) return;
  
  const newPos = {
    id: uid(),
    name: name.toUpperCase().trim().replace(/\s+/g, '_'),
    type: 'joint',
    j: [...latestJoints]
  };
  
  positions.push(newPos);
  renderPositions();
  refreshCode();
}

async function sendJogCommand(axis, direction) {
  const ip = document.getElementById('robot-ip').value.trim();
  if(!ip) return;
  
  const speeds = [0.1, 0.1, 0.1, 0.2, 0.2, 0.2];
  const cmdVel = [0,0,0,0,0,0];
  cmdVel[axis] = speeds[axis] * direction;
  
  const script = `speedl([${cmdVel.join(',')}], a=0.5, t=0.15)\n`;
  try {
    await fetch(RELAY, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ip, code: script})
    });
  } catch(e) {
    console.error("Jog network call failure", e);
  }
}

function startJog(axis, direction) {
  if(jogInterval) clearInterval(jogInterval);
  sendJogCommand(axis, direction);
  jogInterval = setInterval(() => sendJogCommand(axis, direction), 100);
}

function stopJog() {
  if(jogInterval) {
    clearInterval(jogInterval);
    jogInterval = null;
  }
  const ip = document.getElementById('robot-ip').value.trim();
  if(!ip) return;
  fetch(RELAY, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ip, code: "stopl(1.0)\n"})
  }).catch(e => console.error(e));
}

async function toggleFreedrive() {
  const ip = document.getElementById('robot-ip').value.trim();
  if(!ip) { alert("Please input a valid Robot IP."); return; }
  const fBtn = document.getElementById('btn-freedrive');
  
  if(!isFreedrive) {
    const mask = `[${fdAxes.join(',')}]`;
    const script = `def fd_run():\n  freedrive_mode(${mask}, [0,0,0,0,0,0])\n  while True:\n    sync()\n  end\nend\n`;
    try {
      const res = await fetch(RELAY, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ip, code: script})
      });
      const d = await res.json();
      if(d.ok) {
        isFreedrive = true;
        fBtn.innerText = "✋ Freedrive: ACTIVE";
        fBtn.style.borderColor = "var(--ac)";
        fBtn.style.color = "var(--ac)";
      }
    } catch(e) { alert("Freedrive initialization failed: " + e.message); }
  } else {
    try {
      const res = await fetch(RELAY, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ip, code: "end_freedrive_mode()\nkill fd_run\n"})
      });
      const d = await res.json();
      if(d.ok) {
        isFreedrive = false;
        fBtn.innerText = "✋ Freedrive: OFF";
        fBtn.style.borderColor = "var(--bd2)";
        fBtn.style.color = "var(--tx2)";
      }
    } catch(e) { console.error(e); isFreedrive = false; fBtn.innerText = "✋ Freedrive: OFF"; }
  }
}

function toggleFdAxis(index) {
  fdAxes[index] = fdAxes[index] === 1 ? 0 : 1;
  const btn = document.getElementById(`fd-ax-${index}`);
  if(fdAxes[index] === 1) btn.classList.add('on');
  else btn.classList.remove('on');
  
  if(isFreedrive) {
    isFreedrive = false;
    toggleFreedrive();
  }
}

// ═══════════════════════════════════════════════════════════
// CONVERSIONS & FORMATTING
// ═══════════════════════════════════════════════════════════
const rad2deg = r => r * 180 / Math.PI;
const deg2rad = d => d * Math.PI / 180;

function toDisp(val, isAngle) {
  if (!isAngle) return val.toFixed(4);
  return mode === 'deg' ? rad2deg(val).toFixed(2) : val.toFixed(4);
}

function fromDisp(val, isAngle) {
  if (!isAngle) return val;
  return mode === 'deg' ? deg2rad(val) : val;
}

function setMode(m) {
  if (mode === m) return;
  mode = m;
  document.getElementById('btn-deg').classList.toggle('on', m==='deg');
  document.getElementById('btn-rad').classList.toggle('on', m==='rad');
  
  positions.forEach(p => {
    p.j.forEach((val, i) => {
      const inp = document.getElementById(`val-${p.id}-${i}`);
      if (inp) inp.value = toDisp(val, p.type==='joint' || i>=3);
    });
  });
  refreshCode();
}

// ═══════════════════════════════════════════════════════════
// POSITIONS
// ═══════════════════════════════════════════════════════════
function addPos(type) {
  const name = prompt(`Enter ${type} position name:`, `WP_${positions.length+1}`);
  if (!name) return;
  positions.push({
    id: uid(),
    name: name.toUpperCase().trim().replace(/\s+/g,'_'),
    type,
    j: [0, -1.5708, 0, -1.5708, -1.5708, 0]
  });
  renderPositions();
  updateStepDropdowns();
  refreshCode();
}

function delPos(id) {
  if (positions.length <= 1) return;
  positions = positions.filter(p=>p.id!==id);
  renderPositions();
  updateStepDropdowns();
  refreshCode();
}

function togglePosType(id) {
  const p = positions.find(x=>x.id===id);
  if (!p) return;
  p.type = p.type === 'joint' ? 'cart' : 'joint';
  
  if (p.type === 'cart') {
    p.j = [0.2, -0.2, 0.3, 0, 3.1416, 0];
  } else {
    p.j = [0, -1.5708, 0, -1.5708, -1.5708, 0];
  }
  renderPositions();
  refreshCode();
}

function updatePosVal(pid, idx, rawVal) {
  const p = positions.find(x=>x.id===pid);
  if (!p) return;
  const num = parseFloat(rawVal) || 0;
  p.j[idx] = fromDisp(num, p.type==='joint' || idx>=3);
  
  const el = document.getElementById(`val-${pid}-${idx}`);
  if (el) el.classList.toggle('filled', num!==0);
  refreshCode();
}

function renderPositions() {
  const container = document.getElementById('pos-list');
  container.innerHTML = positions.map(p => {
    const labels = p.type==='joint' ? ['B','S','E','W1','W2','W3'] : ['X','Y','Z','Rx','Ry','Rz'];
    const isFull = p.j.some(v=>v!==0);
    return `
      <div class="pos-card" id="card-${p.id}">
        <div class="pos-hdr">
          <div class="pos-dot ${isFull?'full':''}"></div>
          <input class="pos-name" value="${p.name}" onchange="p.name=this.value.toUpperCase();refreshCode()">
          <div class="type-seg">
            <button class="type-btn ${p.type==='joint'?'on':''}" onclick="togglePosType('${p.id}')">JNT</button>
            <button class="type-btn ${p.type==='cart'?'on':''}" onclick="togglePosType('${p.id}')">TCP</button>
          </div>
          <button class="btn-del" onclick="delPos('${p.id}')">✕</button>
        </div>
        <div class="joints">
          ${p.j.map((val,i)=>`
            <div class="jcell">
              <span class="jlabel">${labels[i]}</span>
              <input class="jinput ${val!==0?'filled':''}" id="val-${p.id}-${i}" type="number" step="any"
                value="${toDisp(val, p.type==='joint'||i>=3)}" oninput="updatePosVal('${p.id}',${i},this.value)">
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// STEPS SEQUENCE BUILDER
// ═══════════════════════════════════════════════════════════
const STEP_LABELS = {
  movej:'movej', movel:'movel', movec:'movec',
  activate_gripper:'Act Grip', open_gripper:'Open Grip', close_gripper:'Close Grip',
  loop_n:'Repeat', loop_forever:'Loop', loop_while:'While', if_din:'If', else_block:'Else', block_end:'End',
  sleep:'Sleep', textmsg:'Log', popup:'Popup', set_digital_out:'DOUT', set_payload:'Payload', set_tcp:'Set TCP'
};

const STEP_TAGS = {
  movej:'move', movel:'move', movec:'move',
  activate_gripper:'grip', open_gripper:'grip', close_gripper:'grip',
  loop_n:'flow', loop_forever:'flow', loop_while:'flow', if_din:'flow', else_block:'flow', block_end:'flow',
  sleep:'util', textmsg:'util', popup:'util', set_digital_out:'util', set_payload:'util', set_tcp:'util'
};

function addStep() {
  const type = document.getElementById('new-type').value;
  const step = { id:uid(), type };
  
  if (type==='movej' || type==='movel') step.pid = positions[0]?.id || '';
  if (type==='movec') { step.pid1 = positions[0]?.id || ''; step.pid2 = positions[0]?.id || ''; }
  if (type==='loop_n') step.val = 5;
  if (type==='loop_while' || type==='if_din') { step.pin = 0; step.val = 'True'; }
  if (type==='set_digital_out') { step.pin = 0; step.val = 'True'; }
  if (type==='sleep') step.val = 1.0;
  if (type==='textmsg' || type==='popup') step.val = 'Message';
  
  steps.push(step);
  renderSteps();
  refreshCode();
}

function delStep(id) {
  steps = steps.filter(s=>s.id!==id);
  renderSteps();
  refreshCode();
}

function moveStep(idx, dir) {
  if (idx+dir < 0 || idx+dir >= steps.length) return;
  const tmp = steps[idx];
  steps[idx] = steps[idx+dir];
  steps[idx+dir] = tmp;
  renderSteps();
  refreshCode();
}

function updateStepDropdowns() {
  positions.forEach(p => {
    document.querySelectorAll(`.pid-sel[data-step]`).forEach(sel => {
      const sid = sel.getAttribute('data-step');
      const step = steps.find(s=>s.id===sid);
      const key = sel.classList.contains('p2') ? 'pid2' : (sel.classList.contains('p1') ? 'pid1' : 'pid');
      const currentVal = step ? step[key] : '';
      
      sel.innerHTML = positions.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
      sel.value = currentVal;
    });
  });
}

function renderSteps() {
  const container = document.getElementById('steps-list');
  let indent = 0;
  
  container.innerHTML = steps.map((s,i) => {
    if (s.type === 'block_end' || s.type === 'else_block') indent = Math.max(0, indent-1);
    
    let inline = '';
    if (s.type==='movej' || s.type==='movel') {
      inline = `<select class="step-sel pid-sel" data-step="${s.id}" onchange="steps[${i}].pid=this.value;refreshCode()">
        ${positions.map(p=>`<option value="${p.id}" ${p.id===s.pid?'selected':''}>${p.name}</option>`).join('')}
      </select>`;
    }
    else if (s.type==='movec') {
      inline = `
        <select class="step-sel pid-sel p1" data-step="${s.id}" onchange="steps[${i}].pid1=this.value;refreshCode()">
          ${positions.map(p=>`<option value="${p.id}" ${p.id===s.pid1?'selected':''}>via ${p.name}</option>`).join('')}
        </select>
        <select class="step-sel pid-sel p2" data-step="${s.id}" onchange="steps[${i}].pid2=this.value;refreshCode()">
          ${positions.map(p=>`<option value="${p.id}" ${p.id===s.pid2?'selected':''}>to ${p.name}</option>`).join('')}
        </select>
      `;
    }
    else if (s.type==='loop_n') {
      inline = `<input class="step-inp" type="number" style="width:50px" value="${s.val}" oninput="steps[${i}].val=parseInt(this.value)||1;refreshCode()"> <span style="color:var(--tx3)">times</span>`;
    }
    else if (s.type==='loop_while' || s.type==='if_din') {
      inline = `
        <span style="color:var(--tx3)">DI</span>
        <input class="step-inp" type="number" style="width:40px" value="${s.pin}" oninput="steps[${i}].pin=parseInt(this.value)||0;refreshCode()">
        <select class="step-sel" onchange="steps[${i}].val=this.value;refreshCode()">
          <option value="True" ${s.val==='True'?'selected':''}>HIGH</option>
          <option value="False" ${s.val==='False'?'selected':''}>LOW</option>
        </select>
      `;
    }
    else if (s.type==='set_digital_out') {
      inline = `
        <span style="color:var(--tx3)">DO</span>
        <input class="step-inp" type="number" style="width:40px" value="${s.pin}" oninput="steps[${i}].pin=parseInt(this.value)||0;refreshCode()">
        <select class="step-sel" onchange="steps[${i}].val=this.value;refreshCode()">
          <option value="True" ${s.val==='True'?'selected':''}>= ON</option>
          <option value="False" ${s.val==='False'?'selected':''}>= OFF</option>
        </select>
      `;
    }
    else if (s.type==='sleep') {
      inline = `<input class="step-inp" type="number" step="0.1" style="width:60px" value="${s.val}" oninput="steps[${i}].val=parseFloat(this.value)||0;refreshCode()"> <span style="color:var(--tx3)">s</span>`;
    }
    else if (s.type==='textmsg' || s.type==='popup') {
      inline = `<input class="step-inp" type="text" style="width:120px" value="${s.val}" oninput="steps[${i}].val=this.value;refreshCode()">`;
    }

    let indentHtml = '';
    for (let g=0; g<indent; g++) {
      indentHtml += `<div class="step-indent"><div class="step-indent-line"></div></div>`;
    }

    if (['loop_n','loop_forever','loop_while','if_din','else_block'].includes(s.type)) indent++;

    let specialClass = '';
    if (s.type==='else_block') specialClass = 'else-row';
    else if (s.type==='block_end') specialClass = 'block-end-row';
    else if (['loop_n','loop_forever','loop_while','if_din'].includes(s.type)) specialClass = 'block-open';

    return `
      <div class="step-row">
        ${indentHtml}
        <div class="step ${specialClass}">
          <span class="step-n">${i+1}</span>
          <span class="step-tag tag-${STEP_TAGS[s.type]}">${STEP_LABELS[s.type]}</span>
          <div class="step-content">${inline}</div>
          <div class="step-spacer"></div>
          <div class="step-controls">
            <button class="btn btn-ghost btn-sm" onclick="moveStep(${i},-1)" ${i===0?'disabled':''}>▲</button>
            <button class="btn btn-ghost btn-sm" onclick="moveStep(${i},1)" ${i===steps.length-1?'disabled':''}>▼</button>
            <button class="btn-del" onclick="delStep('${s.id}')">✕</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  document.getElementById('step-count').textContent = `${steps.length} steps`;
}

// ═══════════════════════════════════════════════════════════
// COMPILER & CODE GENERATION
// ═══════════════════════════════════════════════════════════
function buildCode() {
  const v = id => parseFloat(document.getElementById(id).value)||0;
  
  let code = `def ur_program():
  # Settings & Setup
  set_tcp(p[${v('tcp-x')},${v('tcp-y')},${v('tcp-z')},${v('tcp-rx')},${v('tcp-ry')},${v('tcp-rz')}])
  set_payload(${v('pl-w')}, [${v('pl-x')},${v('pl-y')},${v('pl-z')}])
  
  # Global Speeds
  js = ${v('js')}
  ja = ${v('ja')}
  ls = ${v('ls')}
  la = ${v('la')}
  br = ${v('br')}

  # Named Positions\n`;

  positions.forEach(p => {
    const formatted = p.j.map(x=>x.toFixed(5)).join(',');
    if (p.type==='joint') {
      code += `  ${p.name} = [${formatted}]\n`;
    } else {
      code += `  ${p.name} = p[${formatted}]\n`;
    }
  });

  code += `\n  # Robotiq Gripper Subroutines
  def rq_activate():
    textmsg("Gripper activating...")
  end
  def rq_move(pos, speed=100, force=100):
    # Simulated mapping to hardware register values
    sync()
  end\n\n  # Sequence Main Loop\n`;

  let indent = 1;
  const pad = () => '  '.repeat(indent);

  steps.forEach(s => {
    if (s.type === 'block_end' || s.type === 'else_block') indent = Math.max(1, indent-1);

    if (s.type==='movej') {
      const p = positions.find(x=>x.id===s.pid);
      if (p) code += `${pad()}movej(${p.name}, a=ja, v=js, r=br)\n`;
    }
    else if (s.type==='movel') {
      const p = positions.find(x=>x.id===s.pid);
      if (p) code += `${pad()}movel(${p.name}, a=la, v=ls, r=br)\n`;
    }
    else if (s.type==='movec') {
      const p1 = positions.find(x=>x.id===s.pid1);
      const p2 = positions.find(x=>x.id===s.pid2);
      if (p1 && p2) code += `${pad()}movec(${p1.name}, ${p2.name}, a=la, v=ls, r=br)\n`;
    }
    else if (s.type==='activate_gripper') {
      code += `${pad()}rq_activate()\n`;
    }
    else if (s.type==='open_gripper') {
      code += `${pad()}rq_move(${v('go')}, ${v('gs')}, ${v('gf')})\n`;
    }
    else if (s.type==='close_gripper') {
      code += `${pad()}rq_move(${v('gc')}, ${v('gs')}, ${v('gf')})\n`;
    }
    else if (s.type==='sleep') {
      code += `${pad()}sleep(${s.val.toFixed(1)})\n`;
    }
    else if (s.type==='textmsg') {
      code += `${pad()}textmsg("${s.val}")\n`;
    }
    else if (s.type==='popup') {
      code += `${pad()}popup("${s.val}", title="Program Notice", warning=False, error=False)\n`;
    }
    else if (s.type==='set_digital_out') {
      code += `${pad()}set_digital_out(${s.pin}, ${s.val})\n`;
    }
    else if (s.type==='loop_n') {
      code += `${pad()}loop_counter_${s.id.slice(1)} = 0\n`;
      code += `${pad()}while loop_counter_${s.id.slice(1)} < ${s.val}:\n`;
      indent++;
    }
    else if (s.type==='loop_forever') {
      code += `${pad()}while True:\n`;
      indent++;
    }
    else if (s.type==='loop_while') {
      code += `${pad()}while get_digital_in(${s.pin}) == ${s.val}:\n`;
      indent++;
    }
    else if (s.type==='if_din') {
      code += `${pad()}if get_digital_in(${s.pin}) == ${s.val}:\n`;
      indent++;
    }
    else if (s.type==='else_block') {
      code += `${pad()}else:\n`;
      indent++;
    }
    else if (s.type==='block_end') {
      code += `${pad()}# Block End Increment\n`;
    }
  });

  // Automatically safely close any tags forgotten by developer
  while (indent > 1) {
    indent--;
    code += `${pad()}end\n`;
  }

  code += `end\n`;
  return code;
}

// ═══════════════════════════════════════════════════════════
// UI DECORATORS & HIGHLIGHTER
// ═══════════════════════════════════════════════════════════
const NUM = /\b\d+(\.\d+)?\b/g;
const KW = /\b(def|end|while|if|else|return|global)\b/g;
const FNS = /\b(movej|movel|movec|sleep|textmsg|popup|set_digital_out|get_digital_in|set_tcp|set_payload|sync|freedrive_mode|end_freedrive_mode|rq_activate|rq_move)\b/g;
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function highlight(src) {
  return src.split('\n').map(line=>{
    const e=esc(line);
    if(/^\s*#/.test(e)) return `<span class="c-cm">${e}</span>`;
    let c=e,cm='';
    const ci=e.indexOf('#');if(ci>0){c=e.slice(0,ci);cm=e.slice(ci);}
    const sm={};let si=0;
    c=c.replace(/"([^"]*)"/g,(_,inner)=>{const k=`\x00${si++}\x00`;sm[k]=`<span class="c-str">"${inner}"</span>`;return k;});
    c=c.replace(NUM,m=>`<span class="c-num">${m}</span>`)
       .replace(KW, m=>`<span class="c-kw">${m}</span>`)
       .replace(FNS,m=>`<span class="c-fn">${m}</span>`);
    Object.entries(sm).forEach(([k,v])=>{c=c.replace(k,v);});
    if(cm) c+=`<span class="c-cm">${esc(cm)}</span>`;
    return c;
  }).join('\n');
}

function refreshCode(){
  const plain=buildCode();
  document.getElementById('code-out').innerHTML=highlight(plain);
  document.getElementById('code-lines').textContent=plain.split('\n').length+' lines';
  
  // Dynamic validation check
  let depth = 0;
  steps.forEach(s => {
    if(['loop_n','loop_forever','loop_while','if_din'].includes(s.type)) depth++;
    if(s.type === 'block_end') depth--;
  });
  const warn = document.getElementById('warn-box');
  if(depth !== 0) {
    warn.textContent = `⚠️ Nesting Error: Structure depth calculation balance missing block closers (${depth}).`;
    warn.classList.add('show');
  } else {
    warn.classList.remove('show');
  }
}

function copyCode(){
  navigator.clipboard.writeText(buildCode()).then(()=>{
    alert('✓ Copied script successfully to system clipboard.');
  });
}

function downloadCode(){
  const blob = new Blob([buildCode()], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ur_program.script';
  a.click();
}

function toggleCfg() {
  cfgOpen = !cfgOpen;
  document.getElementById('cfg-body').style.display = cfgOpen ? 'flex' : 'none';
  document.getElementById('cfg-tog').textContent = cfgOpen ? '▼ collapse' : '▲ expand';
}

function showTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('on', t.getAttribute('data-tab') === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('on', p.id === `tab-${tabName}`);
  });
}

// ═══════════════════════════════════════════════════════════
// INITIALIZATION & DOM EVENT BINDING
// ═══════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  // Boot State Sequence Arrays
  initSteps();
  renderPositions();
  renderSteps();
  refreshCode();

  // Dynamic state stream loop initialization
  setInterval(fetchRobotState, 350);

  // Structural DOM bindings mapping safely out of the layout execution markup
  document.getElementById('btn-deg').addEventListener('click', () => setMode('deg'));
  document.getElementById('btn-rad').addEventListener('click', () => setMode('rad'));
  document.getElementById('ping-btn').addEventListener('click', pingRobot);
  document.getElementById('send-btn').addEventListener('click', sendToRobot);
  document.getElementById('header-copy-btn').addEventListener('click', copyCode);
  document.getElementById('header-download-btn').addEventListener('click', downloadCode);
  document.getElementById('footer-copy-btn').addEventListener('click', copyCode);
  document.getElementById('footer-download-btn').addEventListener('click', downloadCode);
  document.getElementById('btn-freedrive').addEventListener('click', toggleFreedrive);
  document.getElementById('refresh-state-btn').addEventListener('click', fetchRobotState);
  document.getElementById('record-live-btn').addEventListener('click', recordLivePosition);
  document.getElementById('add-pos-joint-btn').addEventListener('click', () => addPos('joint'));
  document.getElementById('add-pos-cart-btn').addEventListener('click', () => addPos('cart'));
  document.getElementById('cfg-tog').addEventListener('click', toggleCfg);
  document.getElementById('add-step-btn').addEventListener('click', addStep);

  document.getElementById('robot-ip').addEventListener('keydown', (event) => {
    if(event.key === 'Enter') pingRobot();
  });

  // Global delegation handler parsing click actions on configuration tab buttons
  document.querySelectorAll('.tab-bar .tab').forEach(element => {
    element.addEventListener('click', () => {
      const selection = element.getAttribute('data-tab');
      showTab(selection);
    });
  });

  // Realtime structural dynamic parameters changes listeners compiling updates
  const inputs = ['js', 'ja', 'ls', 'la', 'br', 'go', 'gc', 'gs', 'gf', 
                  'tcp-x', 'tcp-y', 'tcp-z', 'tcp-rx', 'tcp-ry', 'tcp-rz',
                  'pl-w', 'pl-x', 'pl-y', 'pl-z'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', refreshCode);
  });

  // Attaching asynchronous manual jog buttons execution actions events loop
  document.querySelectorAll('.jog-grid-container button[data-axis]').forEach(btn => {
    const axis = parseInt(btn.getAttribute('data-axis'));
    const dir = parseInt(btn.getAttribute('data-dir'));
    
    btn.addEventListener('mousedown', () => startJog(axis, dir));
    btn.addEventListener('mouseup', stopJog);
    btn.addEventListener('mouseleave', stopJog);
  });
});