// ═══════════════════════════════════════════════════════════
// STATE — shared mutable state across all modules
// ═══════════════════════════════════════════════════════════

let _uid = 0;
export const uid = () => 'u' + (_uid++);

export let positions = [
  {id:uid(), name:'HOME',     j:[0.00,-1.5708,0.00,-1.5708,-1.5708,0.00], c:[-0.2667,-0.1304,0.6942,-1.2113,-1.2071,1.2057]},
  {id:uid(), name:'APPROACH', j:[0.00,-1.5708,0.00,-1.5708,-1.5708,0.00], c:[-0.2667,-0.1304,0.6942,-1.2113,-1.2071,1.2057]},
  {id:uid(), name:'PICK',     j:[0.00,-1.5708,0.00,-1.5708,-1.5708,0.00], c:[-0.2667,-0.1304,0.6942,-1.2113,-1.2071,1.2057]},
  {id:uid(), name:'PLACE',    j:[0.00,-1.5708,0.00,-1.5708,-1.5708,0.00], c:[-0.2667,-0.1304,0.6942,-1.2113,-1.2071,1.2057]},
];
export function setPositions(arr) { positions = arr; }

export let steps = [];
export function setSteps(arr) { steps = arr; }

// Live telemetry
export let latestJoints = null;
export let latestTcp    = null;
export function setLatestJoints(v) { latestJoints = v; }
export function setLatestTcp(v)    { latestTcp    = v; }

// Freedrive
export let isFreedrive = false;
export function setIsFreedrive(v) { isFreedrive = v; }

// Jogging
export let isJogging = false;
export function setIsJogging(v) { isJogging = v; }

export let fdAxes = [1,1,1,1,1,1];
