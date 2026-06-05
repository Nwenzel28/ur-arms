// ═══════════════════════════════════════════════════════════
// VIEWER 3D — UR3e forward kinematics + Three.js renderer
// ═══════════════════════════════════════════════════════════

// ── UR3e DH Parameters (from Universal Robots spec sheet) ──
// Standard Modified DH convention
// ── UR3e Standard DH Parameters (Official UR Spec Sheet) ──
const DH = {
  a:     [0,        -0.24355, -0.2132,  0,        0,        0      ],
  d:     [0.15185,   0,        0,       0.13105,  0.08535,  0.0921 ],
  alpha: [Math.PI/2, 0,        0,       Math.PI/2,-Math.PI/2, 0    ],
};

// ── Corrected Forward Kinematics (Standard DH with Y-Up Alignment) ──
function fk(joints, THREE) {
  const transforms = [];
  
  // Create a base alignment matrix: Rotates the robot -90 degrees around X
  // so the robot's Z-axis points straight UP along the Three.js Y-axis.
  let T = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

  // Base frame tracking
  transforms.push(T.clone());

  for (let i = 0; i < 6; i++) {
    const theta = joints[i];
    const a     = DH.a[i];
    const d     = DH.d[i];
    const alpha = DH.alpha[i];

    const ct = Math.cos(theta), st = Math.sin(theta);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);

    // Standard DH matrix
    const Ti = new THREE.Matrix4().set(
      ct, -st * ca,  st * sa, a * ct,
      st,  ct * ca, -ct * sa, a * st,
       0,       sa,       ca,      d,
       0,        0,        0,      1
    );

    T = new THREE.Matrix4().multiplyMatrices(T, Ti);
    transforms.push(T.clone());
  }

  return transforms;
}

// Extract position from a Matrix4
function pos(mat, THREE) {
  const p = new THREE.Vector3();
  p.setFromMatrixPosition(mat);
  return p;
}

// ── Scene Setup ─────────────────────────────────────────────
let scene, camera, renderer, controls;
let jointMeshes   = [];  // 6 sphere meshes at joint origins
let linkMeshes    = [];  // 6 cylinder meshes for links
let tcpMesh       = null;
let floorGrid     = null;
let animFrameId   = null;
let THREE         = null;
let OrbitControls = null;

// Colour palette — matches your dark UI theme
const COLORS = {
  base:       0x2a2a30,   // dark grey base plate
  link:       0xC1C1C4,   // arm segments
  joint:      0xf97316,   // orange joints (matches --ac)
  tcp:        0x60a5fa,   // blue TCP marker
  floor:      0x3a3a40,
  gridMain:   0x3a3a44,
  gridSub:    0x25252a,
  background: 0x0e0e10,   // matches --bg
  ambient:    0xffffff,
  shadow:     0x000000,
};

// Physical radii for visual clarity (not spec, just rendering)
const JOINT_RADIUS = 0.022;
const LINK_RADIUS  = 0.018;
const BASE_RADIUS  = 0.040;
const BASE_HEIGHT  = 0.030;
const TCP_SIZE     = 0.018;

export async function initViewer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Remove placeholder text
  container.innerHTML = '';
  container.style.position = 'relative';

  // ── Lazy-load Three.js from CDN ──
  THREE = await loadThree();
  OrbitControls = await loadOrbitControls(THREE);

  // ── Renderer ──
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(COLORS.background, 1);
  container.appendChild(renderer.domElement);
  resizeRenderer(container);

  // ── Scene ──
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.background, 0.8);

  // ── Camera ──
  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 20);
  camera.position.set(0.6, 0.5, 0.7);
  camera.lookAt(0, 0.2, 0);

  // ── Orbit Controls ──
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.2;
  controls.maxDistance = 3.0;
  controls.update();

  // ── Lighting ──
  const ambient = new THREE.AmbientLight(COLORS.ambient, 0.45);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
  keyLight.position.set(1, 2, 1.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far  = 10;
  keyLight.shadow.camera.left = -1;
  keyLight.shadow.camera.right = 1;
  keyLight.shadow.camera.top  = 1;
  keyLight.shadow.camera.bottom = -1;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.25);
  fillLight.position.set(-1, 0.5, -1);
  scene.add(fillLight);

  // ── Floor grid ──
  const gridHelper = new THREE.GridHelper(2, 20, COLORS.gridMain, COLORS.gridSub);
  gridHelper.position.y = -0.001;
  scene.add(gridHelper);

  // Floor plane (receives shadows)
  const floorGeo = new THREE.PlaneGeometry(4, 4);
  const floorMat = new THREE.MeshStandardMaterial({
    color: COLORS.floor,
    roughness: 0.9,
    metalness: 0.1,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── Base plate ──
  const baseMat = new THREE.MeshStandardMaterial({ color: COLORS.base, roughness: 0.7, metalness: 0.3 });
  const baseGeo = new THREE.CylinderGeometry(BASE_RADIUS * 1.4, BASE_RADIUS * 1.6, BASE_HEIGHT, 32);
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = BASE_HEIGHT / 2;
  baseMesh.castShadow = true;
  scene.add(baseMesh);

  // ── Joint & link materials ──
  const jointMat = new THREE.MeshStandardMaterial({ color: COLORS.joint, roughness: 0.4, metalness: 0.6 });
  const linkMat  = new THREE.MeshStandardMaterial({ color: COLORS.link,  roughness: 0.6, metalness: 0.4 });

  // ── Build joints (spheres) ──
  for (let i = 0; i < 6; i++) {
    const r = (i === 0) ? BASE_RADIUS : JOINT_RADIUS * (i < 3 ? 1.3 : 1.0);
    const geo  = new THREE.SphereGeometry(r, 24, 16);
    const mesh = new THREE.Mesh(geo, jointMat.clone());
    mesh.castShadow = true;
    scene.add(mesh);
    jointMeshes.push(mesh);
  }

for (let i = 0; i < 6; i++) {
  const linkGroup = new THREE.Group();
  const a = DH.a[i];
  const d = DH.d[i];

  // 1. Translation along Z by distance 'd'
  if (Math.abs(d) > 0.001) {
    const dGeo = new THREE.CylinderGeometry(LINK_RADIUS, LINK_RADIUS, Math.abs(d), 16);
    const dMesh = new THREE.Mesh(dGeo, linkMat);
    dMesh.castShadow = true;
    
    dMesh.rotation.x = Math.PI / 2; // Orient along Z axis
    dMesh.position.z = d / 2;       // Center it along the displacement
    linkGroup.add(dMesh);
  }

  // 2. Translation along X by distance 'a' (occurs at the end of 'd')
  if (Math.abs(a) > 0.001) {
    const aGeo = new THREE.CylinderGeometry(LINK_RADIUS, LINK_RADIUS, Math.abs(a), 16);
    const aMesh = new THREE.Mesh(aGeo, linkMat);
    aMesh.castShadow = true;
    
    aMesh.rotation.z = Math.PI / 2; // Orient along X axis
    aMesh.position.x = a / 2;       // Center it along the displacement
    aMesh.position.z = d;           // Push it down to the end of the Z offset
    linkGroup.add(aMesh);
  }

  scene.add(linkGroup);
  linkMeshes.push(linkGroup);
}

  // ── TCP marker (small blue octahedron) ──
  const tcpGeo = new THREE.OctahedronGeometry(TCP_SIZE, 0);
  const tcpMat = new THREE.MeshStandardMaterial({ color: COLORS.tcp, roughness: 0.3, metalness: 0.7, emissive: COLORS.tcp, emissiveIntensity: 0.2 });
  tcpMesh = new THREE.Mesh(tcpGeo, tcpMat);
  tcpMesh.castShadow = true;
  scene.add(tcpMesh);

  // ── TCP axis indicator lines ──
  addTcpAxes();

  // ── Resize observer ──
  const ro = new ResizeObserver(() => resizeRenderer(container));
  ro.observe(container);

  // ── Render loop ──
  function animate() {
    animFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Draw once in home position
  updateViewer([0, -Math.PI/2, 0, -Math.PI/2, -Math.PI/2, 0]);
}

// ── TCP Axes helper lines ────────────────────────────────────
let tcpAxesGroup = null;
function addTcpAxes() {
  tcpAxesGroup = new THREE.Group();
  const len = 0.05;
  const axes = [
    { dir: [1,0,0], color: 0xef4444 },  // X — red
    { dir: [0,1,0], color: 0x22c55e },  // Y — green
    { dir: [0,0,1], color: 0x60a5fa },  // Z — blue
  ];
  axes.forEach(({ dir, color }) => {
    const mat = new THREE.LineBasicMaterial({ color });
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(...dir).multiplyScalar(len),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    tcpAxesGroup.add(new THREE.Line(geo, mat));
  });
  scene.add(tcpAxesGroup);
}

// ── Main update — call with [j0..j5] in radians ─────────────
export function updateViewer(joints) {
  if (!THREE || !scene) return;

  // Get cumulative matrices [base_corrected, T0, T1, T2, T3, T4, T5]
  const transforms = fk(joints, THREE);

  // 1. Position each link group using its parent frame
  for (let i = 0; i < 6; i++) {
    const meshGroup = linkMeshes[i];
    
    // The link geometry moves out from the cumulative position of the previous frame
    meshGroup.position.setFromMatrixPosition(transforms[i]);
    meshGroup.quaternion.setFromRotationMatrix(transforms[i]);
  }

  // 2. Position joint spheres precisely at the connection joints
  // Joint 0 (Base shoulder attachment) is at transforms[1], Joint 1 at transforms[2], etc.
  for (let i = 0; i < 6; i++) {
    const p = pos(transforms[i + 1], THREE);
    jointMeshes[i].position.copy(p);
    
    // Also match rotation so joint decorations rotate accurately
    const q = new THREE.Quaternion();
    transforms[i + 1].decompose(new THREE.Vector3(), q, new THREE.Vector3());
    jointMeshes[i].quaternion.copy(q);
  }

  // 3. TCP marker + axes at end-effector (transforms[6] / T5 frame)
  const tcpPos = pos(transforms[6], THREE);
  const tcpRot = new THREE.Quaternion();
  transforms[6].decompose(new THREE.Vector3(), tcpRot, new THREE.Vector3());

  tcpMesh.position.copy(tcpPos);
  tcpMesh.quaternion.copy(tcpRot);

  if (tcpAxesGroup) {
    tcpAxesGroup.position.copy(tcpPos);
    tcpAxesGroup.quaternion.copy(tcpRot);
  }
}

// ── Helpers ──────────────────────────────────────────────────
function resizeRenderer(container) {
  if (!renderer || !camera) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── CDN loaders ──────────────────────────────────────────────
function loadThree() {
  return new Promise((resolve, reject) => {
    if (window.THREE) { resolve(window.THREE); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = () => resolve(window.THREE);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadOrbitControls(THREE) {
  return new Promise((resolve, reject) => {
    if (window.OrbitControls) { resolve(window.OrbitControls); return; }
    const s = document.createElement('script');
    // r128-compatible OrbitControls
    s.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';
    s.onload = () => resolve(window.THREE.OrbitControls || window.OrbitControls);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}