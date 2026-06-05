// ═══════════════════════════════════════════════════════════
// VIEWER 3D — UR3e with official mesh files
// Mesh origins sourced from official ur3e.urdf (ros-industrial)
// DH parameters from Universal Robots official spec sheet
// ═══════════════════════════════════════════════════════════

const PI = Math.PI;

// ── UR3e Standard DH Parameters ────────────────────────────
const DH = {
  a:     [0,        -0.24355, -0.2132,  0,        0,        0      ],
  d:     [0.15185,   0,        0,       0.13105,  0.08535,  0.0921 ],
  alpha: [PI/2,      0,        0,       PI/2,    -PI/2,     0      ],
};

// ── Forward Kinematics ──────────────────────────────────────
function fk(joints, THREE) {
  const transforms = []; // End-of-link frames (for TCP / next link)
  const meshFrames = []; // Start-of-link frames (for URDF meshes)

  let T = new THREE.Matrix4().makeRotationX(-PI / 2);
  transforms.push(T.clone());
  meshFrames.push(T.clone()); // Frame 0: Base mesh attaches here

  for (let i = 0; i < 6; i++) {
    const theta = joints[i];
    const a = DH.a[i];
    const d = DH.d[i];
    const alpha = DH.alpha[i];

    // 1. Joint Rotation & Z-Translation (Start of Link)
    // URDF visual meshes are physically anchored here!
    const Rz = new THREE.Matrix4().makeRotationZ(theta);
    const Tz = new THREE.Matrix4().makeTranslation(0, 0, d);
    const T_mesh = T.clone().multiply(Rz).multiply(Tz);

    meshFrames.push(T_mesh.clone()); // Frame i+1: Link mesh attaches here

    // 2. Link Length & Twist (End of Link)
    // Moves the frame to the starting point of the NEXT joint
    const Tx = new THREE.Matrix4().makeTranslation(a, 0, 0);
    const Rx = new THREE.Matrix4().makeRotationX(alpha);
    T = T_mesh.multiply(Tx).multiply(Rx);

    transforms.push(T.clone());
  }
  
  return { transforms, meshFrames };
}

function getPos(mat, THREE) {
  return new THREE.Vector3().setFromMatrixPosition(mat);
}

// ── Mesh origin data from official ur3e.urdf ───────────────
// Each entry: { xyz: [x,y,z], rpy: [r,p,y] }
// These are the <visual><origin> values for each link.
// Applied as a local offset when attaching mesh to its DH frame.
const MESH_ORIGINS = [
  { xyz: [0,      0,       0     ], rpy: [0,      0,   PI   ] }, // base       (frame 0)
  { xyz: [0,      0,       0     ], rpy: [0,      0,   PI   ] }, // shoulder   (frame 1)
  { xyz: [0,      0,       0.12  ], rpy: [PI/2,   0,  -PI/2 ] }, // upperarm   (frame 2)
  { xyz: [0,      0,       0.027 ], rpy: [PI/2,   0,  -PI/2 ] }, // forearm    (frame 3)
  { xyz: [0,      0,      -0.104 ], rpy: [PI/2,   0,   0    ] }, // wrist1     (frame 4)
  { xyz: [0,      0,      -0.08535], rpy: [0,     0,   0    ] }, // wrist2     (frame 5)
  { xyz: [0,      0,      -0.0921 ], rpy: [PI/2,  0,   0    ] }, // wrist3     (frame 6)
];

const MESH_NAMES = ['base','shoulder','upperarm','forearm','wrist1','wrist2','wrist3'];
const MESH_BASE_URL = 'https://nwenzel28.github.io/ur-arms/meshes/ur3e/';

// Build a 4×4 matrix from xyz + rpy (intrinsic XYZ Euler)
function originMatrix(xyz, rpy, THREE) {
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3(...xyz);
  const euler = new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX');
  const quat = new THREE.Quaternion().setFromEuler(euler);
  mat.compose(pos, quat, new THREE.Vector3(1, 1, 1));
  return mat;
}

// ── TCP offset helpers ──────────────────────────────────────
function tcpOffsetMatrix(offset, THREE) {
  const { x=0, y=0, z=0, rx=0, ry=0, rz=0 } = offset;
  const angle = Math.sqrt(rx*rx + ry*ry + rz*rz);
  const q = new THREE.Quaternion();
  if (angle > 1e-9) q.setFromAxisAngle(new THREE.Vector3(rx/angle, ry/angle, rz/angle), angle);
  const mat = new THREE.Matrix4().makeRotationFromQuaternion(q);
  mat.setPosition(x, y, z);
  return mat;
}

// ── Scene state ─────────────────────────────────────────────
let scene, camera, renderer, orbitControls;
let meshObjects   = [];   // one THREE.Object3D per link (0=base … 6=wrist3)
let tcpMesh       = null;
let tcpAxesGroup  = null;
let flangeMarker  = null;
let offsetLine    = null;
let THREE         = null;
let OC            = null;
let _lastJoints   = [0, -PI/2, 0, -PI/2, -PI/2, 0];
let _meshesLoaded = false;

// ── Public: init ────────────────────────────────────────────
export async function initViewer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  container.style.position = 'relative';

  THREE = await loadScript(
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    () => window.THREE
  );
  OC = await loadScript(
    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
    () => window.THREE.OrbitControls || window.OrbitControls
  );

  // ── Renderer ──
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0e0e10, 1);
  container.appendChild(renderer.domElement);
  sizeRenderer(container);

  // ── Scene ──
  scene = new THREE.Scene();

  // ── Camera ──
  camera = new THREE.PerspectiveCamera(42, 1, 0.001, 10);
  camera.position.set(0.7, 0.55, 0.65);
  camera.lookAt(0, 0.25, 0);

  // ── Orbit controls ──
  orbitControls = new OC(camera, renderer.domElement);
  orbitControls.target.set(0, 0.25, 0);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.minDistance = 0.15;
  orbitControls.maxDistance = 2.5;
  orbitControls.update();

  // ── Lighting ──
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(1.0, 2.0, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(1024);
  key.shadow.camera.near = 0.1; key.shadow.camera.far = 8;
  key.shadow.camera.left = -0.8; key.shadow.camera.right = 0.8;
  key.shadow.camera.top = 1.2;  key.shadow.camera.bottom = -0.2;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6688cc, 0.30);
  rim.position.set(-1.0, 0.6, -1.2);
  scene.add(rim);

  // ── Floor ──
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.92, metalness: 0.05 })
  );
  floor.rotation.x = -PI/2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(2, 16, 0x3a3a44, 0x25252a);
  grid.position.y = 0.001;
  scene.add(grid);

  // ── TCP octahedron ──
  tcpMesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.014, 0),
    new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.25, metalness: 0.75, emissive: 0x60a5fa, emissiveIntensity: 0.18 })
  );
  scene.add(tcpMesh);

  // ── TCP axis lines ──
  tcpAxesGroup = new THREE.Group();
  [
    { dir: [1,0,0], color: 0xef4444 },
    { dir: [0,1,0], color: 0x22c55e },
    { dir: [0,0,1], color: 0x60a5fa },
  ].forEach(({ dir, color }) => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0,0,0),
      new THREE.Vector3(...dir).multiplyScalar(0.055)
    ]);
    tcpAxesGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
  });
  scene.add(tcpAxesGroup);

  // ── Flange ring (visible only when TCP offset is non-zero) ──
  flangeMarker = new THREE.Mesh(
    new THREE.TorusGeometry(0.022, 0.0025, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, transparent: true, opacity: 0.7 })
  );
  flangeMarker.visible = false;
  scene.add(flangeMarker);

  // ── Offset line ──
  offsetLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.6 })
  );
  offsetLine.visible = false;
  scene.add(offsetLine);

  // ── Resize observer ──
  new ResizeObserver(() => sizeRenderer(container)).observe(container);

  // ── Render loop ──
  (function animate() {
    requestAnimationFrame(animate);
    orbitControls.update();
    renderer.render(scene, camera);
  })();

  // Show loading indicator while meshes load
  showLoadingOverlay(container);

  // Load Collada loader then all meshes
  await loadColladaLoader();
  await loadAllMeshes();

  hideLoadingOverlay(container);
  updateViewer(_lastJoints);
}

// ── Load ColladaLoader from CDN ─────────────────────────────
function loadColladaLoader() {
  return loadScript(
    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/ColladaLoader.js',
    () => window.THREE.ColladaLoader
  );
}

// ── Load all 7 meshes ───────────────────────────────────────
function loadAllMeshes() {
  const loader = new THREE.ColladaLoader();
  const grey = new THREE.MeshStandardMaterial({ color: 0xb0b0b5, roughness: 0.55, metalness: 0.35 });

  const promises = MESH_NAMES.map((name, i) => {
    return new Promise((resolve) => {
      loader.load(
        MESH_BASE_URL + name + '.dae',
        (collada) => {
          const obj = collada.scene;

          // Override all materials to match the dark UI theme
          obj.traverse(child => {
            if (child.isMesh) {
              child.material = grey.clone();
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Wrap in a pivot group so we can apply the URDF mesh origin offset
          const pivot = new THREE.Group();
          const originMat = originMatrix(MESH_ORIGINS[i].xyz, MESH_ORIGINS[i].rpy, THREE);
          const offsetPos = new THREE.Vector3();
          const offsetQuat = new THREE.Quaternion();
          originMat.decompose(offsetPos, offsetQuat, new THREE.Vector3());
          obj.position.copy(offsetPos);
          obj.quaternion.copy(offsetQuat);
          pivot.add(obj);

          meshObjects[i] = pivot;
          scene.add(pivot);
          resolve();
        },
        undefined,
        (err) => {
          console.warn(`Failed to load ${name}.dae:`, err);
          // Fallback: tiny invisible group so index stays correct
          meshObjects[i] = new THREE.Group();
          scene.add(meshObjects[i]);
          resolve();
        }
      );
    });
  });

  return Promise.all(promises).then(() => { _meshesLoaded = true; });
}

// ── Public: update ──────────────────────────────────────────
export function updateViewer(joints, tcpOffset = null) {
  if (!THREE || !scene) return;
  if (joints) _lastJoints = joints;
  if (!_meshesLoaded) return;

  // Extract both the mesh anchorage frames and the cumulative transforms
  const { transforms, meshFrames } = fk(_lastJoints, THREE);

  // ── Position Meshes ──
  // Each mesh pivot sits at its start-of-link DH frame
  for (let i = 0; i < 7; i++) {
    if (!meshObjects[i]) continue;
    
    // CRITICAL FIX: Use meshFrames, NOT transforms!
    const mat = meshFrames[i]; 
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    mat.decompose(p, q, new THREE.Vector3());
    
    meshObjects[i].position.copy(p);
    meshObjects[i].quaternion.copy(q);
  }

  // ── TCP ──
  const flangePos = getPos(transforms[6], THREE);
  const flangeQuat = new THREE.Quaternion();
  transforms[6].decompose(new THREE.Vector3(), flangeQuat, new THREE.Vector3());

  let tcpPos = flangePos.clone();
  let tcpQuat = flangeQuat.clone();

  if (tcpOffset) {
    const tcpMat = new THREE.Matrix4().multiplyMatrices(transforms[6], tcpOffsetMatrix(tcpOffset, THREE));
    tcpMat.decompose(tcpPos, tcpQuat, new THREE.Vector3());
  }

  tcpMesh.position.copy(tcpPos);
  tcpMesh.quaternion.copy(tcpQuat);
  tcpAxesGroup.position.copy(tcpPos);
  tcpAxesGroup.quaternion.copy(tcpQuat);

  const hasOffset = tcpOffset &&
    (Math.abs(tcpOffset.x) + Math.abs(tcpOffset.y) + Math.abs(tcpOffset.z) +
     Math.abs(tcpOffset.rx) + Math.abs(tcpOffset.ry) + Math.abs(tcpOffset.rz)) > 1e-6;

  if (flangeMarker) {
    flangeMarker.visible = !!hasOffset;
    if (hasOffset) { flangeMarker.position.copy(flangePos); flangeMarker.quaternion.copy(flangeQuat); }
  }

  updateOffsetLine(flangePos, tcpPos, !!hasOffset);
}

// ── Helpers ─────────────────────────────────────────────────
function updateOffsetLine(from, to, visible) {
  if (!offsetLine) return;
  offsetLine.visible = visible;
  if (!visible) return;
  const pos = offsetLine.geometry.attributes.position;
  if (pos) {
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
  } else {
    offsetLine.geometry.setFromPoints([from.clone(), to.clone()]);
  }
}

function sizeRenderer(container) {
  if (!renderer || !camera) return;
  const w = container.clientWidth;
  const h = container.clientHeight || 380;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loadScript(url, getResult) {
  return new Promise((resolve, reject) => {
    try { const r = getResult(); if (r) { resolve(r); return; } } catch(e) {}
    const s = document.createElement('script');
    s.src = url;
    s.onload  = () => resolve(getResult());
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function showLoadingOverlay(container) {
  const el = document.createElement('div');
  el.id = 'viewer-loading';
  el.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;
    justify-content:center;color:var(--tx3);font:600 12px var(--mono);
    background:var(--bg);pointer-events:none;letter-spacing:.08em;`;
  el.textContent = 'LOADING MESHES…';
  container.appendChild(el);
}

function hideLoadingOverlay(container) {
  const el = container.querySelector('#viewer-loading');
  if (el) el.remove();
}