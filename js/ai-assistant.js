// ═══════════════════════════════════════════════════════════
// AI-ASSISTANT — Gemini-powered Q&A chat widget
//
// Self-contained: injects its own toggle button + panel, so it
// doesn't depend on tab-specific markup. Talks only to relay.py
// (action: 'ai_ask'), which holds the Gemini API key server-side.
// The browser never sees or sends the key.
// ═══════════════════════════════════════════════════════════
import { RELAY } from './network.js';
import { positions, steps, globalSettings, isSimulationMode, simJoints, simTcp } from './state.js';

let _history = [];   // [{role:'user'|'model', text}]
let _open = false;
let _mode = 'ask';   // 'ask' | 'generate'

// ── Minimal, safe markdown renderer ──────────────────────────
// Escapes HTML first, then converts a small, deliberate subset of
// markdown (bold, inline code, code blocks, bullet/numbered lists,
// line breaks). Not a full markdown parser — just enough for the
// formatting Gemini actually produces in these answers.
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mdToHtml(raw) {
  const text = escapeHtml(raw);

  // Pull out fenced code blocks first so their contents aren't touched
  // by inline rules below.
  const blocks = [];
  let withPlaceholders = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const idx = blocks.push(`<pre class="ai-codeblock"><code>${code.trim()}</code></pre>`) - 1;
    return `\x00BLOCK${idx}\x00`;
  });

  // Split into lines to handle lists + paragraphs
  const lines = withPlaceholders.split('\n');
  let html = '';
  let listType = null; // 'ul' | 'ol' | null

  const closeList = () => {
    if (listType) { html += `</${listType}>`; listType = null; }
  };

  const inlineFormat = (line) =>
    line
      .replace(/`([^`]+?)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>');

  for (let line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);

    if (bullet) {
      if (listType !== 'ul') { closeList(); html += '<ul class="ai-list">'; listType = 'ul'; }
      html += `<li>${inlineFormat(bullet[1])}</li>`;
    } else if (numbered) {
      if (listType !== 'ol') { closeList(); html += '<ol class="ai-list">'; listType = 'ol'; }
      html += `<li>${inlineFormat(numbered[1])}</li>`;
    } else {
      closeList();
      if (line.trim() === '') {
        html += '<br>';
      } else if (/^\x00BLOCK\d+\x00$/.test(line.trim())) {
        html += line.trim();
      } else {
        html += `<div>${inlineFormat(line)}</div>`;
      }
    }
  }
  closeList();

  // Swap code-block placeholders back in
  html = html.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => blocks[+i]);

  return html;
}

// ── Build a compact context snapshot to send with every question ──
function buildContext() {
  return {
    simulationMode: isSimulationMode,
    positions: positions.map(p => ({ name: p.name, j: p.j, c: p.c })),
    stepCount: steps.length,
    steps: steps.map(s => ({ ...s })),
    settings: globalSettings,
    currentJoints: isSimulationMode ? simJoints : undefined,
    currentTcp: isSimulationMode ? simTcp : undefined,
  };
}

// ── UI injection ──────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('ai-assist-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-assist-styles';
  style.textContent = `
    #ai-toggle-btn{
      position:fixed;bottom:20px;right:20px;z-index:500;
      width:52px;height:52px;border-radius:50%;
      background:var(--ac);color:#fff;border:none;cursor:pointer;
      font-size:22px;display:flex;align-items:center;justify-content:center;
      box-shadow:0 4px 14px rgba(0,0,0,.4);transition:.15s;
    }
    #ai-toggle-btn:hover{background:var(--ac2);transform:scale(1.05)}
    #ai-panel{
      position:fixed;bottom:82px;right:20px;z-index:500;
      width:340px;max-width:calc(100vw - 32px);height:440px;max-height:calc(100vh - 120px);
      background:var(--sf);border:1px solid var(--bd);border-radius:var(--rl);
      display:none;flex-direction:column;overflow:hidden;
      box-shadow:0 10px 40px rgba(0,0,0,.5);
    }
    #ai-panel.open{display:flex}
    #ai-panel-hdr{
      padding:10px 13px;background:var(--sf2);border-bottom:1px solid var(--bd);
      display:flex;align-items:center;gap:8px;flex-shrink:0;
    }
    #ai-panel-hdr .ai-title{font:600 11px var(--mono);color:var(--tx2);letter-spacing:.06em;text-transform:uppercase;flex:1}
    #ai-panel-close{background:none;border:none;color:var(--tx3);cursor:pointer;font-size:16px;padding:2px 6px}
    #ai-panel-close:hover{color:var(--tx)}
    #ai-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
    #ai-msgs::-webkit-scrollbar{width:4px}
    #ai-msgs::-webkit-scrollbar-thumb{background:var(--bd2);border-radius:2px}
    .ai-msg{max-width:88%;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
    .ai-msg.user{align-self:flex-end;background:var(--ac);color:#fff;border-bottom-right-radius:2px}
    .ai-msg.model{align-self:flex-start;background:var(--sf2);color:var(--tx);border:1px solid var(--bd);border-bottom-left-radius:2px}
    .ai-msg.err{align-self:flex-start;background:var(--rdlo);color:var(--rd);border:1px solid #ef444440}
    .ai-msg.hint{align-self:center;color:var(--tx3);font-size:11px;text-align:center;background:none}
    .ai-msg code{background:rgba(255,255,255,.08);border:1px solid var(--bd2);border-radius:3px;padding:1px 4px;font:11px var(--mono);}
    .ai-msg.user code{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.3);}
    .ai-msg strong{font-weight:700;color:inherit}
    .ai-msg .ai-list{margin:2px 0 2px 18px;padding:0}
    .ai-msg .ai-list li{margin:2px 0}
    .ai-msg .ai-codeblock{background:#07070a;border:1px solid var(--bd2);border-radius:6px;padding:8px 10px;margin:6px 0;overflow-x:auto}
    .ai-msg .ai-codeblock code{background:none;border:none;padding:0;font:11px var(--mono);color:#c8c8d8;white-space:pre}
    #ai-mode-toggle{display:flex;border:1px solid var(--bd2);border-radius:6px;overflow:hidden;flex-shrink:0}
    .ai-mode-btn{padding:4px 9px;font:600 10px var(--mono);border:none;background:none;color:var(--tx2);cursor:pointer;transition:.15s;letter-spacing:.03em}
    .ai-mode-btn.on{background:var(--ac);color:#fff}
    .ai-preview{max-width:96%!important;display:flex;flex-direction:column;gap:6px}
    .ai-preview-title{font-weight:700;color:var(--ac)}
    .ai-preview-summary{color:var(--tx2);font-size:11px}
    .ai-preview-errhdr{color:var(--rd);font-weight:600;margin-top:4px}
    .ai-preview-warnhdr{color:var(--tx3);font-weight:600;margin-top:4px}
    .ai-err-list{color:var(--rd)}
    .ai-warn-list{color:var(--tx3)}
    .ai-preview-btns{display:flex;gap:8px;margin-top:6px}
    .ai-preview-apply{flex:1;background:var(--gn);border:none;color:#000;font-weight:700;border-radius:var(--r);padding:7px 0;cursor:pointer;font-size:11px}
    .ai-preview-apply:disabled{background:var(--bd2);color:var(--tx3);cursor:default}
    .ai-preview-discard{background:none;border:1px solid var(--bd2);color:var(--tx2);border-radius:var(--r);padding:7px 12px;cursor:pointer;font-size:11px}
    .ai-preview-discard:hover{border-color:var(--rd);color:var(--rd)}
    .ai-preview-discard:disabled{opacity:.4;cursor:default}
    #ai-input-row{display:flex;gap:6px;padding:10px;border-top:1px solid var(--bd);flex-shrink:0}
    #ai-input{flex:1;background:var(--bg);border:1px solid var(--bd);border-radius:var(--r);color:var(--tx);padding:8px 10px;font:12px var(--sans);resize:none}
    #ai-input:focus{outline:none;border-color:var(--ac)}
    #ai-send{background:var(--ac);border:none;color:#fff;border-radius:var(--r);padding:0 14px;cursor:pointer;font-size:12px;font-weight:600}
    #ai-send:disabled{opacity:.4;cursor:default}
    .ai-typing{display:inline-flex;gap:3px;align-self:flex-start;padding:8px 10px}
    .ai-typing span{width:5px;height:5px;border-radius:50%;background:var(--tx3);animation:ai-bounce 1s infinite}
    .ai-typing span:nth-child(2){animation-delay:.15s}
    .ai-typing span:nth-child(3){animation-delay:.3s}
    @keyframes ai-bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}
  `;
  document.head.appendChild(style);
}

function injectDom() {
  if (document.getElementById('ai-toggle-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'ai-toggle-btn';
  btn.title = 'Ask the AI assistant';
  btn.innerHTML = '💬';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'ai-panel';
  panel.innerHTML = `
    <div id="ai-panel-hdr">
      <span class="ai-title">Program Assistant</span>
      <div id="ai-mode-toggle">
        <button class="ai-mode-btn on" id="ai-mode-ask" type="button">Ask</button>
        <button class="ai-mode-btn" id="ai-mode-gen" type="button">Generate</button>
        <button class="ai-mode-btn" id="ai-mode-mod" type="button">Modify</button>
      </div>
      <button id="ai-panel-close" title="Close">✕</button>
    </div>
    <div id="ai-msgs">
      <div class="ai-msg hint" id="ai-hint">Ask me about your positions, steps, or how a block works. I can see your current project but I can't change it yet.</div>
    </div>
    <div id="ai-input-row">
      <textarea id="ai-input" rows="1" placeholder="Ask a question…"></textarea>
      <button id="ai-send">Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  btn.addEventListener('click', togglePanel);
  document.getElementById('ai-panel-close').addEventListener('click', togglePanel);
  document.getElementById('ai-mode-ask').addEventListener('click', () => setMode('ask'));
  document.getElementById('ai-mode-gen').addEventListener('click', () => setMode('generate'));
  document.getElementById('ai-mode-mod').addEventListener('click', () => setMode('modify'));

  const input = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send');
  sendBtn.addEventListener('click', () => sendFromInput());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFromInput();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });
}

function setMode(mode) {
  _mode = mode;
  document.getElementById('ai-mode-ask').classList.toggle('on', mode === 'ask');
  document.getElementById('ai-mode-gen').classList.toggle('on', mode === 'generate');
  document.getElementById('ai-mode-mod').classList.toggle('on', mode === 'modify');
  const input = document.getElementById('ai-input');
  const hint = document.getElementById('ai-hint');
  if (mode === 'ask') {
    input.placeholder = 'Ask a question…';
    if (hint) hint.textContent = "Ask me about your positions, steps, or how a block works. I can see your current project but I can't change it yet.";
  } else if (mode === 'generate') {
    input.placeholder = 'Describe the program you want…';
    if (hint) hint.textContent = "Describe a program (e.g. \"pick from HOME and sort by size into two bins\"). I'll generate steps, validate them, and show you a preview before anything is added — nothing is applied automatically.";
  } else {
    input.placeholder = 'Describe the change to make…';
    if (hint) hint.textContent = "Describe a targeted edit to your CURRENT program (e.g. \"add a case for part_size == 210 near the top of the if/elseif chain\"). I'll show exactly what's added/removed before anything changes.";
  }
}

function togglePanel() {
  _open = !_open;
  document.getElementById('ai-panel').classList.toggle('open', _open);
  if (_open) document.getElementById('ai-input')?.focus();
}

function appendMsg(role, text) {
  const wrap = document.getElementById('ai-msgs');
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  if (role === 'model' || role === 'err') {
    div.innerHTML = mdToHtml(text);
  } else {
    div.textContent = text;
  }
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function showTyping() {
  const wrap = document.getElementById('ai-msgs');
  const div = document.createElement('div');
  div.className = 'ai-typing';
  div.id = 'ai-typing-indicator';
  div.innerHTML = '<span></span><span></span><span></span>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function hideTyping() {
  document.getElementById('ai-typing-indicator')?.remove();
}

async function sendFromInput() {
  const input = document.getElementById('ai-input');
  const text = input.value.trim();
  if (!text) return;

  const sendBtn = document.getElementById('ai-send');
  input.value = '';
  input.style.height = 'auto';
  input.disabled = true;
  sendBtn.disabled = true;

  try {
    if (_mode === 'generate') {
      await generateProgram(text);
    } else {
      await sendQuestion(text);
    }
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

async function sendQuestion(question) {
  appendMsg('user', question);
  _history.push({ role: 'user', text: question });
  showTyping();

  try {
    const res = await fetch(RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ai_ask',
        question,
        context: buildContext(),
        history: _history.slice(0, -1) // everything except the question we just sent
      })
    });
    const data = await res.json();
    hideTyping();

    if (data.ok) {
      appendMsg('model', data.answer);
      _history.push({ role: 'model', text: data.answer });
    } else {
      appendMsg('err', `⚠ ${data.error || 'The assistant could not answer that.'}`);
    }
  } catch (e) {
    hideTyping();
    appendMsg('err', `⚠ Could not reach the relay server (${e.message}). Is relay.py running?`);
  }
}

// ── Stage 2: Generate program JSON, validate, preview, apply ──
async function generateProgram(prompt) {
  appendMsg('user', prompt);
  showTyping();

  try {
    const res = await fetch(RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ai_generate_program',
        prompt,
        context: {
          positions: positions.map(p => ({ id: p.id, name: p.name, j: p.j, c: p.c })),
          settings: globalSettings
        }
      })
    });
    const data = await res.json();
    hideTyping();

    if (!data.ok) {
      let msg = data.error || 'Could not generate a program.';
      if (data.raw) msg += `\n\nModel's raw output (for debugging):\n\`\`\`\n${data.raw}\n\`\`\``;
      appendMsg('err', `⚠ ${msg}`);
      return;
    }

    const { validateProgram } = await import('./program-validator.js');
    const validation = validateProgram(data.program, positions);
    appendProgramPreview(data.program, validation);
  } catch (e) {
    hideTyping();
    appendMsg('err', `⚠ Could not reach the relay server (${e.message}). Is relay.py running?`);
  }
}

function appendProgramPreview(program, validation) {
  const wrap = document.getElementById('ai-msgs');
  const { errors, warnings, summary } = validation;

  const div = document.createElement('div');
  div.className = 'ai-msg model ai-preview';

  let html = `<div class="ai-preview-title">📋 Generated Program</div>`;
  html += `<div class="ai-preview-summary">${summary.newPositions} new position(s), ${summary.newSteps} new step(s) — will be appended to the end of your current program.</div>`;

  if (errors.length) {
    html += `<div class="ai-preview-errhdr">⚠ ${errors.length} problem(s) found — not safe to apply:</div>`;
    html += `<ul class="ai-list ai-err-list">${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  }
  if (warnings.length) {
    html += `<div class="ai-preview-warnhdr">Notes:</div>`;
    html += `<ul class="ai-list ai-warn-list">${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
  }
  div.innerHTML = html;

  const btnRow = document.createElement('div');
  btnRow.className = 'ai-preview-btns';

  const applyBtn = document.createElement('button');
  applyBtn.className = 'ai-preview-apply';
  applyBtn.textContent = errors.length ? 'Fix required before applying' : 'Apply to Program';
  applyBtn.disabled = errors.length > 0;

  const discardBtn = document.createElement('button');
  discardBtn.className = 'ai-preview-discard';
  discardBtn.textContent = 'Discard';

  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    discardBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
    try {
      await applyProgram(program);
      applyBtn.textContent = '✓ Applied to Program';
    } catch (e) {
      applyBtn.textContent = 'Apply failed — see below';
      appendMsg('err', `⚠ Failed to apply: ${e.message}`);
      discardBtn.disabled = false;
    }
  });

  discardBtn.addEventListener('click', () => div.remove());

  btnRow.appendChild(applyBtn);
  btnRow.appendChild(discardBtn);
  div.appendChild(btnRow);

  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

// Merge a validated generated program into the live app state.
// Regenerates every id through the app's own uid() counter so generated
// ids can never collide with existing ones, then rewrites pid/via/to
// references that pointed at newly-created positions to match.
async function applyProgram(program) {
  const stateMod = await import('./state.js');
  const setupMod = await import('./tab-setup.js');
  const progMod = await import('./tab-program.js');

  const idMap = {};

  const newPositions = (program.positions || []).map(p => {
    const newId = stateMod.uid();
    idMap[p.id] = newId;
    return { id: newId, name: p.name, j: p.j, c: p.c || [0, 0, 0, 0, 0, 0] };
  });

  const newSteps = (program.steps || []).map(s => {
    const newId = stateMod.uid();
    idMap[s.id] = newId;
    const copy = { ...s, id: newId };
    ['pid', 'via', 'to'].forEach(field => {
      if (copy[field] && idMap[copy[field]]) copy[field] = idMap[copy[field]];
      // else: references an existing (pre-generation) position id — leave untouched
    });
    return copy;
  });

  stateMod.setPositions([...stateMod.positions, ...newPositions]);
  stateMod.setSteps([...stateMod.steps, ...newSteps]);
  if (program.settings) stateMod.setGlobalSettings(program.settings);

  setupMod.renderPositions();
  progMod.renderSteps();
  progMod.refreshCode();
}

// ── Public init ─────────────────────────────────────────────
export function initAiAssistant() {
  injectStyles();
  injectDom();
}