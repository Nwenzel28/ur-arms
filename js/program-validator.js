// ═══════════════════════════════════════════════════════════
// PROGRAM-VALIDATOR — semantic validation for AI-generated program JSON
//
// This is the "human/simulator validates before it runs" gate for
// Stage 2. Gemini's JSON-mode output is guaranteed to be *syntactically*
// valid JSON, but nothing guarantees it matches our actual step schema,
// references real positions, or has balanced block nesting. This module
// checks all of that before anything is allowed to merge into state.js.
//
// No dependencies. Mirrors the real schema used by tab-program.js
// (defaultStep / TAG_INFO), which is the source of truth for the app —
// not just the AI's prompt spec, which could drift.
// ═══════════════════════════════════════════════════════════

const BLOCK_OPENERS = ['loop_start', 'if_start', 'thread_start', 'folder'];

// type -> { required: [ [key, validator, label] ] }
const isNum  = v => typeof v === 'number' && Number.isFinite(v);
const isStr  = v => typeof v === 'string';
const isBool = v => typeof v === 'boolean';

const STEP_SCHEMA = {
  movej:            { pid: isStr },
  movel:            { pid: isStr },
  movec:            { via: isStr, to: isStr },
  guarded_move:     { speed: isNum, retract: isNum },
  activate_gripper: {},
  open_gripper:     {},
  close_gripper:    {},
  read_gripper:     { varName: isStr },
  loop_start:       { loopType: v => v === 'forever' || v === 'times' },
  if_start:         { condition: isStr },
  else_if:          { condition: isStr },
  else:             {},
  wait_cond:        { condition: isStr },
  thread_start:     { threadName: isStr },
  end:              {},
  assign:           { varName: isStr, varValue: isStr },
  timer:            { timerAct: v => v === 'start' || v === 'read', timerVar: isStr },
  sleep:            { sec: isNum },
  textmsg:          { msg: isStr },
  popup:            { msg: isStr },
  halt:             {},
  set_digital_out:  { port: isNum, val: isBool },
  set_payload:      { weight: isNum },
  set_tcp:          { pose: isStr },
  comment:          { commentTxt: isStr },
  folder:           { folderName: isStr },
};

const REF_FIELDS = {
  movej: ['pid'], movel: ['pid'], movec: ['via', 'to'],
};

function isJointArray(v) {
  return Array.isArray(v) && v.length === 6 && v.every(isNum);
}

/**
 * Validate an AI-generated program object.
 * @param {object} program - parsed JSON: { positions, steps, settings }
 * @param {Array}  existingPositions - the user's current positions (from state.js),
 *                 so pid/via/to referencing an already-saved position is allowed.
 * @returns {{ ok: boolean, errors: string[], warnings: string[], summary: object }}
 */
export function validateProgram(program, existingPositions = []) {
  const errors = [];
  const warnings = [];

  if (!program || typeof program !== 'object' || Array.isArray(program)) {
    return { ok: false, errors: ['Top-level response is not a JSON object.'], warnings: [], summary: null };
  }

  const { positions, steps, settings } = program;

  // ── Top-level shape ──
  if (!Array.isArray(positions)) errors.push('"positions" must be an array (missing or wrong type).');
  if (!Array.isArray(steps))     errors.push('"steps" must be an array (missing or wrong type).');
  if (settings !== undefined && (typeof settings !== 'object' || Array.isArray(settings))) {
    errors.push('"settings" must be an object if present.');
  }
  Object.keys(program).forEach(k => {
    if (!['positions', 'steps', 'settings'].includes(k)) {
      warnings.push(`Unexpected top-level key "${k}" — ignored.`);
    }
  });

  if (errors.length) return { ok: false, errors, warnings, summary: null };

  // ── Positions ──
  const posIds = new Set();
  const seenPosIds = new Set();
  (positions || []).forEach((p, i) => {
    const tag = `positions[${i}]`;
    if (!p || typeof p !== 'object') { errors.push(`${tag} is not an object.`); return; }
    if (!isStr(p.id) || !p.id) { errors.push(`${tag}.id must be a non-empty string.`); }
    else {
      if (seenPosIds.has(p.id)) errors.push(`${tag}.id "${p.id}" is duplicated within the generated positions.`);
      seenPosIds.add(p.id);
      posIds.add(p.id);
    }
    if (!isStr(p.name) || !p.name) errors.push(`${tag}.name must be a non-empty string.`);
    if (!isJointArray(p.j)) errors.push(`${tag}.j must be an array of 6 numbers (radians).`);
    if (p.c !== undefined && !isJointArray(p.c)) errors.push(`${tag}.c must be an array of 6 numbers if present.`);
  });

  // Combined pool of valid position ids: existing (from state.js) + newly generated
  const existingIds = new Set((existingPositions || []).map(p => p.id));
  const allKnownPosIds = new Set([...existingIds, ...posIds]);

  // ── Steps ──
  const seenStepIds = new Set();
  const blockStack = []; // stack of { type, index }

  (steps || []).forEach((s, i) => {
    const tag = `steps[${i}]`;
    if (!s || typeof s !== 'object') { errors.push(`${tag} is not an object.`); return; }

    if (!isStr(s.id) || !s.id) {
      errors.push(`${tag}.id must be a non-empty string.`);
    } else {
      if (seenStepIds.has(s.id)) errors.push(`${tag}.id "${s.id}" is duplicated within the generated steps.`);
      seenStepIds.add(s.id);
    }

    const schema = STEP_SCHEMA[s.type];
    if (!schema) {
      errors.push(`${tag} has unknown type "${s.type}".`);
      return;
    }

    // Required fields + type checks
    Object.entries(schema).forEach(([key, check]) => {
      if (!(key in s)) {
        errors.push(`${tag} (${s.type}) is missing required field "${key}".`);
      } else if (!check(s[key])) {
        errors.push(`${tag} (${s.type}) field "${key}" has an invalid value: ${JSON.stringify(s[key])}.`);
      }
    });

    // loop_start.times needs loopCount
    if (s.type === 'loop_start' && s.loopType === 'times' && !isNum(s.loopCount)) {
      errors.push(`${tag} (loop_start) has loopType "times" but loopCount is missing or not a number.`);
    }

    // Position references
    (REF_FIELDS[s.type] || []).forEach(field => {
      const ref = s[field];
      if (isStr(ref) && ref && !allKnownPosIds.has(ref)) {
        errors.push(`${tag} (${s.type}) references unknown position id "${ref}" in "${field}".`);
      }
    });

    // Block nesting
    if (BLOCK_OPENERS.includes(s.type)) {
      blockStack.push({ type: s.type, index: i });
    } else if (s.type === 'end') {
      if (blockStack.length === 0) {
        errors.push(`${tag} is an "end" with no matching open block (loop_start/if_start/thread_start/folder).`);
      } else {
        blockStack.pop();
      }
    } else if (s.type === 'else_if' || s.type === 'else') {
      const top = blockStack[blockStack.length - 1];
      if (!top || top.type !== 'if_start') {
        warnings.push(`${tag} (${s.type}) does not appear to be inside an open "if_start" block.`);
      }
    }
  });

  if (blockStack.length > 0) {
    blockStack.forEach(b => {
      errors.push(`steps[${b.index}] ("${b.type}") is never closed with a matching "end".`);
    });
  }

  const summary = {
    newPositions: (positions || []).length,
    newSteps: (steps || []).length,
    settingsProvided: !!settings,
  };

  return { ok: errors.length === 0, errors, warnings, summary };
}