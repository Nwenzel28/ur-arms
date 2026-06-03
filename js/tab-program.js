// ═══════════════════════════════════════════════════════════
// TAB-PROGRAM — sequence builder + URScript compiler
// ═══════════════════════════════════════════════════════════
import { positions, steps, setSteps, uid } from './state.js';

// ── CONSTANTS ──
const OPENERS = ['loop_start','loop_n','loop_forever','loop_while','if_start','if_din','thread_start','folder'];

const TAG_INFO = {
  movej:'MOVEJ', movel:'MOVEL', movec:'MOVEC', guarded_move:'UNTIL',
  open_gripper:'GRIP', close_gripper:'GRIP', activate_gripper:'GRIP', read_gripper:'GRIP?',
  sleep:'WAIT', textmsg:'LOG', popup:'POP', set_digital_out:'DOUT',
  set_payload:'LOAD', set_tcp:'TCP',
  loop_start:'LOOP', if_start:'IF', else_if:'ELSEIF', else:'ELSE',
  wait_cond:'WAIT', halt:'HALT', thread_start:'THRD', end:'END',
  assign:'VAR', timer:'TIME', comment:'//', folder:'FLDR',
};

const TAG_COLOR = {
  movej:'tag-move', movel:'tag-move', movec:'tag-move', guarded_move:'tag-move',
  open_gripper:'tag-grip', close_gripper:'tag-grip', activate_gripper:'tag-grip', read_gripper:'tag-util',
  sleep:'tag-util', textmsg:'tag-util', popup:'tag-util', set_digital_out:'tag-util',
  set_payload:'tag-util', set_tcp:'tag-util',
  loop_start:'tag-logic', if_start:'tag-logic', else_if:'tag-logic', else:'tag-logic',
  wait_cond:'tag-logic', halt:'tag-logic', thread_start:'tag-logic', end:'tag-logic',
  assign:'tag-util', timer:'tag-util', comment:'tag-util', folder:'tag-util',
};

// ── DEFAULT STEP FACTORY ──
export function defaultStep(type) {
  const s = {id:uid(), type};
  if (type==='movej') s.pid = positions[0]?.id ?? null;
  if (type==='movel') s.pid = positions[0]?.id ?? null;
  if (type==='movec') { s.via = positions[0]?.id ?? null; s.to = s.via; }
  if (type==='guarded_move') { s.speed = 0.02; s.retract = 0.0; }
  if (type==='sleep') s.sec = 1;
  if (type==='textmsg') s.msg = '';
  if (type==='popup') { s.msg = 'Hello'; s.pType = 'msg'; }
  if (type==='set_digital_out') { s.port=0; s.val=true; }
  if (type==='set_payload') s.weight = 0.5;
  if (type==='set_tcp') s.pose = '0,0,0,0,0,0';
  if (type==='loop_start') { s.loopType = 'forever'; s.loopCount = 5; }
  if (type==='if_start') s.condition = 'get_digital_in(1) == True';
  if (type==='else_if') s.condition = 'get_digital_in(1) == False';
  if (type==='wait_cond') s.condition = 'get_digital_in(1) == True';
  if (type==='read_gripper') s.varName = 'part_size';
  if (type==='assign') { s.varName = 'my_var'; s.varValue = '0'; }
  if (type==='timer') { s.timerAct = 'start'; s.timerVar = 'timer_1'; }
  if (type==='thread_start') s.threadName = 'thread_1';
  if (type==='folder') s.folderName = 'My Folder';
  if (type==='comment') s.commentTxt = 'Note here';
  return s;
}

// ── STEP MUTATIONS ──
export function addStep(type) {
  steps.push(defaultStep(type));
  renderSteps(); refreshCode();
}

export function deleteStep(sid) {
  setSteps(steps.filter(s=>s.id!==sid));
  renderSteps(); refreshCode();
}

export function moveStep(sid, dir) {
  const i = steps.findIndex(s=>s.id===sid), j=i+dir;
  if (j<0||j>=steps.length) return;
  [steps[i],steps[j]]=[steps[j],steps[i]];
  renderSteps(); refreshCode();
}

export function changeType(sid, type) {
  const i = steps.findIndex(s=>s.id===sid); if (i<0) return;
  steps[i] = {...defaultStep(type), id:sid};
  renderSteps(); refreshCode();
}

export function upd(sid, key, val) {
  const s = steps.find(x=>x.id===sid);
  if (s) { s[key]=val; refreshCode(); }
}

// ── RENDER ──
export function renderSteps() {
  const list = document.getElementById('program-sequence');
  if (!list) return;

  if (steps.length === 0) {
    list.innerHTML = `<div style="color:var(--tx3);text-align:center;margin-top:40px;font-size:13px;">Add elements from the right panel →</div>`;
    return;
  }

  list.innerHTML = steps.map((s, si) => {
    const tag = TAG_INFO[s.type] || '?';
    const tagCls = TAG_COLOR[s.type] || 'tag-util';
    return `<div class="step" id="st-${s.id}" draggable="true"
        ondragstart="window._prog.dragStart(event,${si})"
        ondragover="window._prog.dragOver(event)"
        ondragleave="window._prog.dragLeave(event)"
        ondrop="window._prog.dragDrop(event,${si})"
        ondragend="window._prog.dragEnd(event)">
      <span class="step-n">${si+1}</span>
      <span class="step-tag ${tagCls}">${tag}</span>
      <span style="font-size:11px;color:var(--tx3);min-width:60px;">${s.type}</span>
      ${stepInlineParams(s)}
      <span style="flex:1"></span>
      <div class="step-controls">
        <button class="btn btn-sm btn-ghost" onclick="window._prog.moveStep('${s.id}',-1)" ${si===0?'disabled':''}>↑</button>
        <button class="btn btn-sm btn-ghost" onclick="window._prog.moveStep('${s.id}',1)" ${si===steps.length-1?'disabled':''}>↓</button>
        <button class="btn btn-sm" style="color:var(--rd);border-color:var(--rdlo);" onclick="window._prog.deleteStep('${s.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function stepInlineParams(s) {
  const si = `'${s.id}'`;
  const posOpts = positions.map(p=>`<option value="${p.id}" ${s.pid===p.id?'selected':''}>${p.name}</option>`).join('');
  switch(s.type) {
    case 'movej': case 'movel':
      return `<select class="step-sel" onchange="window._prog.upd(${si},'pid',this.value)">${posOpts}</select>`;
    case 'movec': {
      const mk = sel => positions.map(p=>`<option value="${p.id}" ${sel===p.id?'selected':''}>${p.name}</option>`).join('');
      return `<span style="font-size:10px;color:var(--tx3)">via</span>
        <select class="step-sel" onchange="window._prog.upd(${si},'via',this.value)">${mk(s.via)}</select>
        <span style="font-size:10px;color:var(--tx3)">to</span>
        <select class="step-sel" onchange="window._prog.upd(${si},'to',this.value)">${mk(s.to)}</select>`;
    }
    case 'sleep':
      return `<input class="step-inp" type="number" min="0" step="0.1" value="${s.sec??1}" style="width:60px"
              oninput="window._prog.upd(${si},'sec',+this.value)">
              <span style="font-size:10px;color:var(--tx3)">sec</span>`;
    case 'textmsg': case 'popup':
      return `<input class="step-inp" type="text" value="${esc(s.msg??'')}" style="width:180px"
        placeholder="Message..." oninput="window._prog.upd(${si},'msg',this.value)">`;
    case 'loop_start':
      return `<select class="step-inp" onchange="window._prog.upd(${si},'loopType',this.value)">
                <option value="forever" ${s.loopType==='forever'?'selected':''}>Forever</option>
                <option value="times" ${s.loopType==='times'?'selected':''}>Times</option>
              </select>
              ${s.loopType==='times' ? `<input class="step-inp" type="number" value="${s.loopCount}" style="width:50px" oninput="window._prog.upd(${si},'loopCount',+this.value)">` : ''}`;
    case 'if_start': case 'else_if': case 'wait_cond':
      return `<input class="step-inp" type="text" value="${esc(s.condition??'')}" style="width:160px" oninput="window._prog.upd(${si},'condition',this.value)">`;
    case 'assign':
      return `<input class="step-inp" type="text" value="${s.varName}" style="width:70px" oninput="window._prog.upd(${si},'varName',this.value)"> =
              <input class="step-inp" type="text" value="${s.varValue}" style="width:90px" oninput="window._prog.upd(${si},'varValue',this.value)">`;
    case 'comment':
      return `// <input class="step-inp" type="text" value="${esc(s.commentTxt??'')}" style="width:150px" oninput="window._prog.upd(${si},'commentTxt',this.value)">`;
    case 'folder':
      return `📁 <input class="step-inp" type="text" value="${esc(s.folderName??'')}" style="width:130px" oninput="window._prog.upd(${si},'folderName',this.value)">`;
    default: return '';
  }
}

// ── DRAG AND DROP ──
let draggedIdx = null;
export const dragStart = (e, idx) => { draggedIdx = idx; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; };
export const dragOver  = (e) => { e.preventDefault(); e.target.closest('.step')?.classList.add('drag-over'); };
export const dragLeave = (e) => { e.target.closest('.step')?.classList.remove('drag-over'); };
export const dragEnd   = (e) => { e.currentTarget.classList.remove('dragging'); draggedIdx=null; document.querySelectorAll('.step').forEach(c=>c.classList.remove('drag-over')); };
export const dragDrop  = (e, dropIdx) => {
  e.preventDefault(); e.target.closest('.step')?.classList.remove('drag-over');
  if (draggedIdx===null||draggedIdx===dropIdx) return;
  const moved = steps.splice(draggedIdx, 1)[0];
  steps.splice(dropIdx, 0, moved);
  renderSteps(); refreshCode();
};

// ── CODE GENERATION ──
export function buildCode() {
  const T = '    ';
  // Default motion settings (no settings panel in v2 yet; use sensible defaults)
  const js=1.05, ja=1.4, ls=0.25, la=1.2, br=0.0;

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
  L.push(`${T}# Gripper init`);
  L.push(`${T}socket_close("rq_srv")`);
  L.push(`${T}socket_open("127.0.0.1", 63352, "rq_srv")`);
  L.push(`${T}socket_send_string("SET ACT 1", "rq_srv")`);
  L.push(`${T}socket_send_byte(10, "rq_srv")`);
  L.push(`${T}sync()`);
  L.push(`${T}socket_send_string("SET GTO 1", "rq_srv")`);
  L.push(`${T}socket_send_byte(10, "rq_srv")`);
  L.push(`${T}sync()`);
  L.push(`${T}sleep(3.0)`);
  L.push('');
  L.push(`${T}# Main sequence`);

  let ind = 1;
  let stack = [];
  const getTab = () => T.repeat(ind);

  steps.forEach((s, si) => {
    if (s.type === 'end') {
      ind = Math.max(1, ind - 1);
      let tab = getTab();
      let parent = stack.pop() || { type: 'unknown' };
      if (parent.type === 'folder')         L.push(`${tab}# └ End ${parent.folderName}`);
      else if (parent.type === 'loop_start' && parent.loopType === 'times') {
        L.push(`${tab}loop_var_${parent._si} = loop_var_${parent._si} + 1`);
        L.push(`${tab}end`);
      }
      else if (parent.type === 'thread_start') { L.push(`${tab}end`); L.push(`${tab}run ${parent.threadName}()`); }
      else L.push(`${tab}end`);
      return;
    }
    if (s.type === 'else') { ind = Math.max(1, ind - 1); L.push(`${getTab()}else:`); ind++; return; }
    if (s.type === 'else_if') { ind = Math.max(1,ind-1); L.push(`${getTab()}elif (${s.condition}):`); ind++; return; }

    const tab = getTab();
    switch(s.type) {
      case 'movej': { const p=positions.find(x=>x.id===s.pid); L.push(`${tab}movej(${p?p.name+'_J':'UNKNOWN'}, a=JOINT_ACCEL, v=JOINT_SPEED, r=BLEND_RADIUS)`); break; }
      case 'movel': { const p=positions.find(x=>x.id===s.pid); L.push(`${tab}movel(${p?p.name+'_C':'UNKNOWN'}, a=LINEAR_ACCEL, v=LINEAR_SPEED, r=BLEND_RADIUS)`); break; }
      case 'movec': { const v=positions.find(x=>x.id===s.via),t=positions.find(x=>x.id===s.to); L.push(`${tab}movec(${v?v.name+'_C':'UNKNOWN'}, ${t?t.name+'_C':'UNKNOWN'}, a=LINEAR_ACCEL, v=LINEAR_SPEED)`); break; }
      case 'sleep':           L.push(`${tab}sleep(${s.sec??1.0})`); break;
      case 'textmsg':         L.push(`${tab}textmsg("${s.msg??'Log'}")`); break;
      case 'set_digital_out': L.push(`${tab}set_digital_out(${s.port??0}, ${s.val!==false?'True':'False'})`); break;
      case 'set_payload':     L.push(`${tab}set_payload(${s.weight??0})`); break;
      case 'set_tcp':         L.push(`${tab}set_tcp(p[${s.pose??'0,0,0,0,0,0'}])`); break;
      case 'assign':          L.push(`${tab}${s.varName} = ${s.varValue}`); break;
      case 'comment':         L.push(`${tab}# ${s.commentTxt??''}`); break;
      case 'halt':            L.push(`${tab}halt`); break;
      case 'wait_cond':
        L.push(`${tab}while not (${s.condition}):`);
        L.push(`${tab}${T}sync()`);
        L.push(`${tab}end`);
        break;
      case 'loop_start':
        if (s.loopType==='times') { s._si=si; L.push(`${tab}loop_var_${si} = 0`); L.push(`${tab}while (loop_var_${si} < ${s.loopCount}):`); }
        else L.push(`${tab}while True:`);
        stack.push(s); ind++; break;
      case 'if_start':    L.push(`${tab}if (${s.condition}):`); stack.push(s); ind++; break;
      case 'thread_start':L.push(`${tab}thread ${s.threadName}():`); stack.push(s); ind++; break;
      case 'folder':      L.push(`${tab}# 📂 ${s.folderName}`); stack.push(s); ind++; break;
      case 'open_gripper':
        L.push(`${tab}socket_open("127.0.0.1", 63352, "rq_srv")`);
        L.push(`${tab}socket_send_string("SET POS 0", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}sync()`);
        L.push(`${tab}socket_close("rq_srv")`);
        break;
      case 'close_gripper':
        L.push(`${tab}socket_open("127.0.0.1", 63352, "rq_srv")`);
        L.push(`${tab}socket_send_string("SET POS 255", "rq_srv")`);
        L.push(`${tab}socket_send_byte(10, "rq_srv")`);
        L.push(`${tab}sync()`);
        L.push(`${tab}socket_close("rq_srv")`);
        break;
      case 'popup':
        L.push(`${tab}socket_open("169.254.231.213", 50000, "ui_socket")`);
        L.push(`${tab}socket_send_string("${s.msg}", "ui_socket")`);
        L.push(`${tab}local ui_response = ""`);
        L.push(`${tab}while (ui_response != "continue"):`);
        L.push(`${tab}${T}ui_response = socket_read_string("ui_socket", timeout=0)`);
        L.push(`${tab}${T}sleep(0.1)`);
        L.push(`${tab}end`);
        L.push(`${tab}socket_close("ui_socket")`);
        break;
      default: break;
    }
  });

  L.push(`${T}socket_close("rq_srv")`);
  L.push(`${T}textmsg("=== Program Complete ===")`);
  L.push('end');
  L.push('master_program()');
  return L.join('\n') + '\n';
}

// ── SYNTAX HIGHLIGHT ──
const KW  = /\b(def|end|if|elif|else|while|global|local|return|True|False|not|and|or|break|sync)\b/g;
const FNS = /\b(movej|movel|movec|sleep|textmsg|popup|set_tcp|set_payload|set_digital_out|get_digital_in|socket_open|socket_close|socket_send_string|socket_send_byte|stopl|speedl|freedrive_mode|halt|master_program)\b/g;
const NUM = /(?<!["'\w])(-?\d+\.?\d*)\b/g;

function highlight(code) {
  return code.split('\n').map(line => {
    const e = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (/^\s*#/.test(e)) return `<span class="c-cm">${e}</span>`;
    let c=e, cm='';
    const ci = e.indexOf('#');
    if (ci>0) { c=e.slice(0,ci); cm=e.slice(ci); }
    const sm={}; let si=0;
    c = c.replace(/"([^"]*)"/g, (_,inner) => { const k=`\x00${si++}\x00`; sm[k]=`<span class="c-str">"${inner}"</span>`; return k; });
    c = c.replace(NUM, m=>`<span class="c-num">${m}</span>`)
         .replace(KW,  m=>`<span class="c-kw">${m}</span>`)
         .replace(FNS, m=>`<span class="c-fn">${m}</span>`);
    Object.entries(sm).forEach(([k,v])=>{ c=c.replace(k,v); });
    if (cm) c += `<span class="c-cm">${cm.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`;
    return c;
  }).join('\n');
}

export function refreshCode() {
  const out = document.getElementById('code-out');
  if (!out) return;
  const plain = buildCode();
  out.innerHTML = highlight(plain);
}

// ── SEND TO ROBOT ──
export async function sendToRobot() {
  const { RELAY, setDot } = await import('./network.js');
  const ip = document.getElementById('robot-ip').value.trim();
  if (!ip) { alert('Enter the robot IP address.'); return; }
  const btn = document.getElementById('btn-send-program');
  if (btn) { btn.textContent = 'Sending…'; btn.disabled=true; }
  setDot('sending');
  try {
    const res = await fetch(RELAY, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ip, code: buildCode()})
    });
    const data = await res.json();
    if (data.ok) {
      setDot('ok');
      if (btn) { btn.textContent='✓ Sent!'; btn.style.background='var(--gn)'; }
      setTimeout(()=>{ if(btn){btn.textContent='Send to Robot';btn.style.background='';btn.disabled=false;} }, 2500);
    } else throw new Error(data.error || 'Robot rejected the script');
  } catch(e) {
    setDot('err');
    if (btn) { btn.textContent='✕ Failed'; btn.style.background='var(--rd)'; }
    alert(`Failed to send:\n${e.message}`);
    setTimeout(()=>{ if(btn){btn.textContent='Send to Robot';btn.style.background='';btn.disabled=false;} }, 2500);
  }
}

// ── EXPOSE ──
export function exposeProgram() {
  window._prog = {
    addStep, deleteStep, moveStep, changeType, upd, sendToRobot,
    dragStart, dragOver, dragLeave, dragEnd, dragDrop
  };
}
