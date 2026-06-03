// ═══════════════════════════════════════════════════════════
// MAIN — global init, tab switching, event wiring
// ═══════════════════════════════════════════════════════════
import { pingRobot, emergencyStop, startFreedriveDetection, startPopupPoller, resolvePopup, startJog, stopJog } from './network.js';
import { renderPositions, exposeSetup, addPos, toggleFreedrive, openGripper, closeGripper, recordLivePosition } from './tab-setup.js';
import { renderSteps, refreshCode, exposeProgram, addStep, sendToRobot } from './tab-program.js';
import { initRunTab } from './tab-run.js';

// ── TAB SWITCHING ──
function initTabs() {
  document.querySelectorAll('.tab[data-target]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('on'));
      tab.classList.add('on');
      const target = document.getElementById(tab.dataset.target);
      if (target) target.classList.add('on');
    });
  });
}

// ── HEADER BUTTONS ──
function initHeader() {
  document.getElementById('ping-btn')?.addEventListener('click', pingRobot);
  document.getElementById('global-estop')?.addEventListener('click', emergencyStop);
  document.getElementById('btn-resolve-popup')?.addEventListener('click', resolvePopup);
}

// ── POSITIONS TAB WIRING ──
function initPositionsTab() {
  document.getElementById('btn-freedrive')?.addEventListener('click', toggleFreedrive);
  document.getElementById('btn-get-current')?.addEventListener('click', recordLivePosition);
  document.getElementById('btn-open-gripper')?.addEventListener('click', openGripper);
  document.getElementById('btn-close-gripper')?.addEventListener('click', closeGripper);

  // Add position button
  const addPosBtn = document.createElement('button');
  addPosBtn.className = 'btn btn-sm';
  addPosBtn.style.cssText = 'margin: 8px; font-size: 12px;';
  addPosBtn.textContent = '+ Add Position';
  addPosBtn.addEventListener('click', addPos);
  document.querySelector('.col-left .card-hdr')?.appendChild(addPosBtn);
}

// ── PROGRAM TAB WIRING ──
function initProgramTab() {
  // Wire up the "Add Elements" palette buttons
  document.getElementById('block-palette')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-type]');
    if (btn) addStep(btn.dataset.type);
  });

  // Send to robot button
  document.getElementById('btn-send-program')?.addEventListener('click', sendToRobot);

  // Show Script (debug) toggle
  const scriptSection = document.getElementById('script-debug');
  document.getElementById('btn-show-script')?.addEventListener('click', () => {
    if (scriptSection) scriptSection.style.display = scriptSection.style.display === 'none' ? 'block' : 'none';
  });
}

// ── UPDATE PALETTE BUTTONS TO USE data-type ──
function upgradePalette() {
  const palette = document.getElementById('block-palette');
  if (!palette) return;
  palette.innerHTML = `
    <div style="color:var(--tx3);font-size:11px;text-transform:uppercase;margin-bottom:4px;">Motion</div>
    <button class="btn" data-type="movej">+ Move J</button>
    <button class="btn" data-type="movel">+ Move L</button>
    <button class="btn" data-type="movec">+ Move C</button>
    <button class="btn" data-type="guarded_move">+ Move Until</button>

    <div style="color:var(--tx3);font-size:11px;text-transform:uppercase;margin-top:12px;margin-bottom:4px;">Hardware</div>
    <button class="btn" data-type="open_gripper">+ Open Gripper</button>
    <button class="btn" data-type="close_gripper">+ Close Gripper</button>
    <button class="btn" data-type="activate_gripper">+ Activate Gripper</button>
    <button class="btn" data-type="read_gripper">+ Read Gripper</button>
    <button class="btn" data-type="set_digital_out">+ Digital Out</button>

    <div style="color:var(--tx3);font-size:11px;text-transform:uppercase;margin-top:12px;margin-bottom:4px;">Logic</div>
    <button class="btn" data-type="loop_start">+ Loop</button>
    <button class="btn" data-type="if_start">+ If</button>
    <button class="btn" data-type="else_if">+ Else If</button>
    <button class="btn" data-type="else">+ Else</button>
    <button class="btn" data-type="end">+ End</button>
    <button class="btn" data-type="wait_cond">+ Wait Until</button>
    <button class="btn" data-type="halt">+ Halt</button>

    <div style="color:var(--tx3);font-size:11px;text-transform:uppercase;margin-top:12px;margin-bottom:4px;">Utilities</div>
    <button class="btn" data-type="sleep">+ Sleep</button>
    <button class="btn" data-type="textmsg">+ Log Message</button>
    <button class="btn" data-type="popup">+ Popup</button>
    <button class="btn" data-type="assign">+ Variable</button>
    <button class="btn" data-type="timer">+ Timer</button>
    <button class="btn" data-type="comment">+ Comment</button>
    <button class="btn" data-type="folder">+ Folder</button>
    <button class="btn" data-type="set_payload">+ Set Payload</button>
    <button class="btn" data-type="set_tcp">+ Set TCP</button>
    <button class="btn" data-type="thread_start">+ Thread</button>
  `;
}

// ── ADD SEND + DEBUG BUTTON TO PROGRAM TAB ──
function injectProgramControls() {
  const programCard = document.querySelector('#tab-program .program-card .card-hdr');
  if (programCard) {
    programCard.innerHTML += `
      <div style="display:flex;gap:8px;margin-left:auto;">
        <button class="btn btn-sm" id="btn-show-script">Show Script</button>
        <button class="btn btn-sm btn-send" id="btn-send-program">Send to Robot ▶</button>
      </div>
    `;
  }

  const seqContainer = document.querySelector('#tab-program .program-card');
  if (seqContainer) {
    const debugDiv = document.createElement('div');
    debugDiv.id = 'script-debug';
    debugDiv.style.cssText = 'display:none;padding:12px;border-top:1px solid var(--bd);';
    debugDiv.innerHTML = `<pre id="code-out" style="font-family:var(--mono);font-size:11px;color:var(--tx2);white-space:pre-wrap;max-height:300px;overflow-y:auto;"></pre>`;
    seqContainer.appendChild(debugDiv);
  }
}

// ── BOOT ──
document.addEventListener('DOMContentLoaded', () => {
  // Expose module fns for inline HTML handlers
  exposeSetup();
  exposeProgram();

  initTabs();
  initHeader();
  upgradePalette();
  injectProgramControls();
  initPositionsTab();
  initProgramTab();
  initRunTab();

  // Initial render
  renderPositions();
  renderSteps();
  refreshCode();

  // Background services
  startFreedriveDetection();
  startPopupPoller();
});
