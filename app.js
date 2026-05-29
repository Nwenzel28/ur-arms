const RELAY = 'http://localhost:5678';
let waypoints = [];
let isFreedrive = false;
let latestJoints = [0, 0, 0, 0, 0, 0];

// Dynamic calculation units wrapper based on UI state Selection
function getUnits() {
  return document.getElementById('units-select').value;
}

function toDisp(radVal, isRotational = true) {
  if (!isRotational) return radVal.toFixed(4);
  return getUnits() === 'DEG' ? (radVal * 180 / Math.PI).toFixed(2) : radVal.toFixed(4);
}

function toRad(dispVal, isRotational = true) {
  const v = parseFloat(dispVal) || 0;
  if (!isRotational) return v;
  return getUnits() === 'DEG' ? (v * Math.PI / 180) : v;
}

// Global UI state refresh toggled when users shift between DEG and RAD
function refreshDisplay() {
  const mode = getUnits();
  document.getElementById('unit-speed').textContent = mode === 'DEG' ? 'deg/s' : 'rad/s';
  document.getElementById('unit-accel').textContent = mode === 'DEG' ? 'deg/s²' : 'rad/s²';
  
  fetchRobotState();
  renderWaypoints();
  refreshCode();
}

// Asynchronous real-time position state query targeting Port 30003
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
      latestJoints = joints; // Capture for Record Live functionality
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

// Direct raw URScript code execution delivery utility
async function sendDirect(code) {
  const ip = document.getElementById('robot-ip').value.trim();
  if(!ip) return alert("Please enter the Robot IP address first.");
  try {
    const res = await fetch(RELAY, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ip: ip, code: code})
    });
    const data = await res.json();
    if(!data.ok) alert("Error: " + (data.error || "Execution failed"));
  } catch(e) {
    alert("Failed to reach relay: " + e.message);
  }
}

// Active real-time parsing capture to pull live coordinates array directly into list
function recordLivePosition() {
  const type = document.getElementById('param-type').value;
  const speed = parseFloat(document.getElementById('param-speed').value) || 1.0;
  const accel = parseFloat(document.getElementById('param-accel').value) || 1.4;
  const blend = parseFloat(document.getElementById('param-blend').value) || 0;

  // Add waypoint directly utilizing current raw joint state matrix
  waypoints.push({
    type: type,
    joints: [...latestJoints], 
    speed: toRad(speed),       
    accel: toRad(accel),       
    blend: blend / 1000        
  });

  renderWaypoints();
  refreshCode();
}

// Interactive point-space incremental step jog delivery routine
function jog(axis, direction) {
  const stepMm = parseFloat(document.getElementById('jog-step').value) || 10;
  const stepM = stepMm / 1000;
  const stepRad = toRad(stepMm); 

  let dX = 0, dY = 0, dZ = 0, dRx = 0, dRy = 0, dRz = 0;

  if (axis === 'X') dX = stepM * direction;
  if (axis === 'Y') dY = stepM * direction;
  if (axis === 'Z') dZ = stepM * direction;
  if (axis === 'Rx') dRx = stepRad * direction;
  if (axis === 'Ry') dRy = stepRad * direction;
  if (axis === 'Rz') dRz = stepRad * direction;

  const script = `def jog_p():
  p = get_actual_tcp_pose()
  target = p2l([p[0]+${dX}, p[1]+${dY}, p[2]+${dZ}, p[3]+${dRx}, p[4]+${dRy}, p[5]+${dRz}])
  movel(target, a=1.2, v=0.25)
end
`;
  sendDirect(script);
  setTimeout(fetchRobotState, 800); // Allow physical momentum window prior to state query
}

// Toggles online background freedrive teaching control routine
function toggleFreedrive() {
  const btn = document.getElementById('btn-fd');
  isFreedrive = !isFreedrive;
  if(isFreedrive) {
    btn.textContent = "STOP FREEDRIVE";
    btn.className = "btn";
    btn.style.background = "var(--rd)";
    btn.style.borderColor = "var(--rd)";
    sendDirect("def fd():\n  freedrive_mode()\n  while True:\n    sync()\n  end\nend\n");
  } else {
    btn.textContent = "Enable Freedrive";
    btn.className = "btn btn-ghost";
    btn.style.background = "transparent";
    btn.style.borderColor = "var(--bd2)";
    sendDirect("def stop_fd():\n  end_freedrive_mode()\nend\n");
    setTimeout(fetchRobotState, 500);
  }
}

// Safe programmatic injection to append manually configured data structures
function addWaypoint() {
  const type = document.getElementById('param-type').value;
  const speed = parseFloat(document.getElementById('param-speed').value) || 1.0;
  const accel = parseFloat(document.getElementById('param-accel').value) || 1.4;
  const blend = parseFloat(document.getElementById('param-blend').value) || 0;

  const j = [0,0,0,0,0,0].map((_, idx) => {
    const el = document.getElementById(`live-j${idx}`);
    const currentVal = el ? parseFloat(el.innerText) : 0;
    return toRad(currentVal);
  });

  waypoints.push({
    type: type,
    joints: j,
    speed: toRad(speed),
    accel: toRad(accel),
    blend: blend / 1000
  });

  renderWaypoints();
  refreshCode();
}

function removeWaypoint(idx) {
  waypoints.splice(idx, 1);
  renderWaypoints();
  refreshCode();
}

// Primary layout rendering module tracking operational data array transforms
function renderWaypoints() {
  const container = document.getElementById('pos-list');
  container.innerHTML = '';
  
  waypoints.forEach((wp, idx) => {
    const card = document.createElement('div');
    card.className = 'pos-card';
    
    // Dynamic local unit processing for individual coordinate labels
    const jDisp = wp.joints.map(v => toDisp(v, true));
    
    card.innerHTML = `
      <div class="pos-card-hdr">
        <span class="pos-idx">#${idx+1}</span>
        <span class="pos-type">${wp.type}</span>
        <span style="font-size:10px; color:var(--tx3)">r=${(wp.blend*1000).toFixed(0)}mm</span>
        <button class="btn btn-sm btn-ghost" style="margin-left:auto; color:var(--rd); border:none; padding:0 4px;" onclick="removeWaypoint(${idx})">Delete</button>
      </div>
      <div class="pos-grid">
        <div class="pos-val"><span>Base</span><span>${jDisp[0]}</span></div>
        <div class="pos-val"><span>Shld</span><span>${jDisp[1]}</span></div>
        <div class="pos-val"><span>Elbw</span><span>${jDisp[2]}</span></div>
        <div class="pos-val"><span>Wst1</span><span>${jDisp[3]}</span></div>
        <div class="pos-val"><span>Wst2</span><span>${jDisp[4]}</span></div>
        <div class="pos-val"><span>Wst3</span><span>${jDisp[5]}</span></div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Compiles UI structures into clean, complete native URScript source strings
function buildCode() {
  let s = "def ur_program_builder():\n";
  s += "  # Auto-generated programmatic setup parameters\n";
  s += "  set_analog_outputdomain(0, 1)\n";
  s += "  set_analog_outputdomain(1, 1)\n";
  s += "  set_tool_voltage(24)\n\n";

  if(waypoints.length === 0) {
    s += "  # Add structural waypoints inside layout to generate runtime script\n";
    s += "  popup(\"No waypoints found!\", \"Error\", error=True)\n";
  } else {
    waypoints.forEach((wp, i) => {
      const js = `[${wp.joints.map(v => v.toFixed(5)).join(',')}]`;
      s += `  # Moving toward Waypoint Position Sequence Node #${i+1}\n`;
      s += `  ${wp.type}(${js}, a=${wp.accel.toFixed(3)}, v=${wp.speed.toFixed(3)}, r=${wp.blend.toFixed(4)})\n\n`;
    });
  }
  s += "end\n";
  return s;
}

// Regex lexical matching architecture managing code output rendering layouts
function highlight(code) {
  const KW = /\b(def|end|while|if|else|return|popup)\b/g;
  const FNS = /\b(movej|movel|movep|movec|set_analog_outputdomain|set_tool_voltage|get_actual_tcp_pose|p2l|sync|freedrive_mode|end_freedrive_mode)\b/g;
  const NUM = /\b\d+(\.\d+)?\b/g;
  const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  return code.split('\n').map(line => {
    const e = esc(line);
    if(/^\s*#/.test(e)) return `<span class="c-cm">${e}</span>`;
    let c = e, cm = '';
    const ci = e.indexOf('#');
    if(ci > 0) { c = e.slice(0, ci); cm = e.slice(ci); }
    const sm = {}; let si = 0;
    c = c.replace(/"([^\"]*)"/g, (_, inner) => { const k = `\x00${si++}\x00`; sm[k] = `<span class="c-str">"${inner}"</span>`; return k; });
    c = c.replace(NUM, m => `<span class="c-num">${m}</span>`)
         .replace(KW, m => `<span class="c-kw">${m}</span>`)
         .replace(FNS, m => `<span class="c-fn">${m}</span>`);
    Object.entries(sm).forEach(([k, v]) => { c = c.replace(k, v); });
    if(cm) c += `<span class="c-cm">${esc(cm)}</span>`;
    return c;
  }).join('\n');
}

function refreshCode() {
  const plain = buildCode();
  document.getElementById('code-out').innerHTML = highlight(plain);
  document.getElementById('code-lines').textContent = plain.split('\n').length + ' lines';
}

function copyCode() {
  navigator.clipboard.writeText(buildCode()).then(() => {
    const b = document.querySelector('.hdr .btn');
    const o = b.textContent; b.textContent = '✓ Copied!';
    setTimeout(() => b.textContent = o, 1500);
  });
}

function runProgram() {
  sendDirect(buildCode());
}

// Initialize real-time components on bootup
setInterval(fetchRobotState, 4000); 
refreshCode();