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
      <button id="ai-panel-close" title="Close">✕</button>
    </div>
    <div id="ai-msgs">
      <div class="ai-msg hint">Ask me about your positions, steps, or how a block works. I can see your current project but I can't change it yet.</div>
    </div>
    <div id="ai-input-row">
      <textarea id="ai-input" rows="1" placeholder="Ask a question…"></textarea>
      <button id="ai-send">Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  btn.addEventListener('click', togglePanel);
  document.getElementById('ai-panel-close').addEventListener('click', togglePanel);

  const input = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send');
  sendBtn.addEventListener('click', () => sendQuestion());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });
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
  div.textContent = text;
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

async function sendQuestion() {
  const input = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send');
  const question = input.value.trim();
  if (!question) return;

  appendMsg('user', question);
  _history.push({ role: 'user', text: question });
  input.value = '';
  input.style.height = 'auto';
  input.disabled = true;
  sendBtn.disabled = true;
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
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ── Public init ─────────────────────────────────────────────
export function initAiAssistant() {
  injectStyles();
  injectDom();
}