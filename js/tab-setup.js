// ═══════════════════════════════════════════════════════════
// TAB-SETUP — Positions list, Robot Controls, Live viewer
// ═══════════════════════════════════════════════════════════
import { positions, setPositions, steps, setSteps, latestJoints, latestTcp, uid, isFreedrive, setIsFreedrive, fdAxes } from './state.js';
import { sendDirect, resetFreedriveUI, fetchRobotState } from './network.js';
import { renderSteps, refreshCode } from './tab-program.js';

export const JOINT_LABELS = ['J0','J1','J2','J3','J4','J5'];
export const CART_LABELS  = ['X','Y','Z','Rx','Ry','Rz'];

export function toDisp(rad) { return (rad * 180 / Math.PI).toFixed(2); }
export function fromDisp(deg) { return (parseFloat(deg) || 0) * Math.PI / 180; }

export function renderPositions() {
  const el = document.getElementById('positions-list');
  if (!el) return;
  el.innerHTML = positions.map(pos => {
    if (!pos.c) pos.c = [...pos.j];
    return `
    <div class="pos-card" id="pc-${pos.id}" style="background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);padding:10px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${posComplete(pos)?'var(--gn)':'var(--tx3)'}"></div>
        <input style="flex:1;background:transparent;border:none;border-bottom:1px solid var(--bd);color:var(--tx);font-weight:600;font-size:13px;padding:2px 4px;" 
          value="${pos.name}"
          onchange="window._setup.renamePos('${pos.id}',this.value)"
          onblur="window._setup.renamePos('${pos.id}',this.value)"/>
        <button class="btn btn-sm" style="font-size:10px;padding:3px 8px;" 
          onmousedown="window._setup.startMoveHere('${pos.id}')" 
          onmouseup="window._setup.stopMoveHere()" 
          onmouseleave="window._setup.stopMoveHere()">Move Here</button>
        <button class="btn btn-sm" style="font-size:10px;padding:3px 8px;" 
          onclick="window._setup.setToCurrent('${pos.id}')">Set Current</button>
        <button class="btn btn-sm" style="font-size:10px;padding:3px 6px;color:var(--rd);border-color:var(--rdlo);" onclick="window._setup.deletePos('${pos.id}')">✕</button>
      </div>
      <div style="font-size:10px;color:var(--tx3);text-transform:uppercase;margin-bottom:4px;">Joints (°)</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:8px;">
        ${JOINT_LABELS.map((name, ji) => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            <div style="font-size:9px;color:var(--tx3);">${name}</div>
            <input style="width:100%;background:var(--sf);border:1px solid var(--bd);border-radius:4px;color:var(--tx);font-size:11px;padding:2px;text-align:center;" 
              type="number" step="0.1" value="${toDisp(pos.j[ji])}"
              oninput="window._setup.liveJoint(this,'${pos.id}',${ji},false)"/>
          </div>`).join('')}
      </div>
      <div style="font-size:10px;color:var(--tx3);text-transform:uppercase;margin-bottom:4px;">Cartesian (m/rad)</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;">
        ${CART_LABELS.map((name, ci) => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            <div style="font-size:9px;color:var(--tx3);">${name}</div>
            <input style="width:100%;background:var(--sf);border:1px solid var(--bd);border-radius:4px;color:var(--tx);font-size:11px;padding:2px;text-align:center;" 
              type="number" step="0.0001" value="${pos.c[ci].toFixed(4)}"
              oninput="window._setup.liveJoint(this,'${pos.id}',${ci},true)"/>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function posComplete(pos) {
  return pos.j.some(v => v !== 0) || (pos.c && pos.c.some(v => v !== 0));
}

export function liveJoint(el, pid, index, isCart) {
  const pos = positions.find(p => p.id === pid);
  if (!pos) return;
  if (isCart) {
    if (!pos.c) pos.c = [0,0,0,0,0,0];
    pos.c[index] = parseFloat(el.value) || 0;
  } else {
    pos.j[index] = fromDisp(el.value);
  }
  refreshCode();
}

export function renamePos(pid, val) {
  const pos = positions.find(p=>p.id===pid); if (!pos) return;
  pos.name = val.toUpperCase().replace(/\s+/g,'_').replace(/[^A-Z0-9_]/g,'') || pos.name;
  refreshCode(); renderSteps();
}

export function addPos() {
  positions.push({id:uid(), name:'POS_'+(positions.length+1), j:[0,0,0,0,0,0], c:[0,0,0,0,0,0]});
  renderPositions(); renderSteps(); refreshCode();
}

export function deletePos(pid) {
  if (positions.length <= 1) return;
  setPositions(positions.filter(p=>p.id!==pid));
  // Null out any steps that reference this position
  import('./state.js').then(s => {
    s.setSteps(s.steps.map(st=>{
      if ((st.type==='movej'||st.type==='movel')&&st.pid===pid) return {...st, pid:null};
      if (st.type==='movec'&&st.via===pid) return {...st, via:null};
      if (st.type==='movec'&&st.to===pid)  return {...st, to:null};
      return st;
    }));
    renderPositions(); renderSteps(); refreshCode();
  });
}

export function startMoveHere(pid) {
  const pos = positions.find(p => p.id === pid);
  if (!pos || !pos.c) return;
  const cartStr = pos.c.map(v => v.toFixed(4)).join(',');
  const urscript = `def move_here():\n  movej(p[${cartStr}], a=1.2, v=0.25)\nend\n`;
  resetFreedriveUI();
  sendDirect(urscript);
}

export function stopMoveHere() {
  sendDirect("def stop_move():\n  stopl(2.5)\nend\n");
}

export function setToCurrent(pid) {
  // Re-import to get current module-level values
  import('./state.js').then(s => {
    if (!s.latestJoints || !s.latestTcp) {
      alert("Enable Live Tracker first to get the robot's current coordinates.");
      return;
    }
    const pos = positions.find(p => p.id === pid);
    if (!pos) return;
    pos.j = [...s.latestJoints];
    pos.c = [...s.latestTcp];
    renderPositions(); renderSteps(); refreshCode();
  });
}

export function recordLivePosition() {
  import('./state.js').then(s => {
    if (!s.latestJoints || !s.latestTcp) {
      alert("Enable Live Tracker first to get the robot's current coordinates.");
      return;
    }
    positions.push({
      id: uid(),
      name: 'POS_' + (positions.length + 1),
      j: [...s.latestJoints],
      c: [...s.latestTcp]
    });
    renderPositions(); renderSteps(); refreshCode();
  });
}

export function toggleFreedrive() {
  import('./state.js').then(s => {
    const ip = document.getElementById('robot-ip').value;
    if (!ip) return alert("Enter Robot IP first.");
    const btn = document.getElementById('btn-freedrive');
    if (!s.isFreedrive) {
      s.setIsFreedrive(true);
      btn.textContent = 'Freedrive: ON';
      btn.classList.add('btn-ac');
      sendDirect(`def fd_on():\n  freedrive_mode([${s.fdAxes.join(',')}], p[0,0,0,0,0,0])\n  while True:\n    sync()\n  end\nend\n`);
    } else {
      s.setIsFreedrive(false);
      btn.textContent = 'Freedrive';
      btn.classList.remove('btn-ac');
      sendDirect(`def fd_off():\n  end_freedrive_mode()\nend\n`);
    }
  });
}

export function toggleFdAxis(index) {
  import('./state.js').then(s => {
    const val = s.fdAxes[index] === 1 ? 0 : 1;
    s.setFdAxis(index, val);
    const btn = document.getElementById(`fd-ax-${index}`);
    if (btn) btn.classList.toggle('on', val === 1);
    if (s.isFreedrive) {
      sendDirect(`def fd_on():\n  freedrive_mode([${s.fdAxes.join(',')}], p[0,0,0,0,0,0])\n  while True:\n    sync()\n  end\nend\n`);
    }
  });
}

export function activateGripper() {
  const ip = document.getElementById('robot-ip').value.trim();
  if (!ip) return alert("Enter Robot IP first.");
  const btn = document.getElementById('btn-gripper-activate');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Activating...';
  }
  const urscript = `def live_grp():\n  socket_close("rq_srv")\n  socket_open("127.0.0.1", 63352, "rq_srv")\n  socket_send_string("SET ACT 1", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET GTO 1", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_close("rq_srv")\nend\nlive_grp()`;
  sendDirect(urscript);
}

// Gripper actions
export function openGripper()  { sendDirect(`def grp():\n  socket_close("rq_srv")\n  socket_open("127.0.0.1", 63352, "rq_srv")\n  socket_send_string("SET SPE 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET FOR 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET POS 0", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_close("rq_srv")\nend\ngrp()`); }
export function closeGripper() { sendDirect(`def grp():\n  socket_close("rq_srv")\n  socket_open("127.0.0.1", 63352, "rq_srv")\n  socket_send_string("SET SPE 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET FOR 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_send_string("SET POS 255", "rq_srv")\n  socket_send_byte(10, "rq_srv")\n  sync()\n  socket_close("rq_srv")\nend\ngrp()`); }

// Expose to window for inline HTML event handlers
export function exposeSetup() {
  window._setup = {
    liveJoint, renamePos, addPos, deletePos,
    startMoveHere, stopMoveHere, setToCurrent, recordLivePosition,
    toggleFreedrive, openGripper, closeGripper, toggleFdAxis, activateGripper
  };
}
