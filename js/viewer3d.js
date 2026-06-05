// ═══════════════════════════════════════════════════════════
// VIEWER 3D — UR3e with official .dae meshes
//
// Two FK chains are maintained:
//   1. URDF FK  — for placing the 7 link meshes correctly
//   2. DH FK    — for the TCP marker / offset
//
// URDF joint origins and mesh visual origins from:
//   ros-industrial/universal_robot ur3e.urdf (melodic-devel)
// DH parameters from Universal Robots official spec sheet.
// ═══════════════════════════════════════════════════════════

const PI = Math.PI;

// ── DH Parameters (for TCP only) ───────────────────────────
const DH = {
  a:     [0,        -0.24355, -0.2132,  0,        0,        0      ],
  d:     [0.15185,   0,        0,       0.13105,  0.08535,  0.0921 ],
  alpha: [PI/2,      0,        0,       PI/2,    -PI/2,     0      ],
};

// ── Helpers ─────────────────────────────────────────────────
// Compose a 4×4 matrix from translation + intrinsic XYZ Euler angles
function compose(THREE, x, y, z, rx, ry, rz) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  return m;
}

function rotZ(THREE, angle) {
  return new THREE.Matrix4().makeRotationZ(angle);
}

function mul(a, b) {
  return new THREE.Matrix4().multiplyMatrices(a, b);
}

// ── URDF FK ─────────────────────────────────────────────────
// Returns 7 world-space matrices for the 7 URDF links at given joint angles.
// The base_link_inertia is fixed; joints 0-5 are revolute around local Z.
//
// Chain (from ur3e.urdf):
//   world
//   └─ base_link_inertia  (fixed: rpy="0 0 π")
//      └─ shoulder_link   (joint: xyz="0 0 0.15185"  rpy="0 0 0"    + Rz(j0))
//         └─ upper_arm    (joint: xyz="0 0 0"        rpy="π/2 0 0"  + Rz(j1))
//            └─ forearm   (joint: xyz="-0.24355 0 0" rpy="0 0 0"    + Rz(j2))
//               └─ wrist1 (joint: xyz="-0.2132 0 0.13105" rpy="0 0 0" + Rz(j3))
//                  └─ wrist2 (joint: xyz="0 -0.08535 0" rpy="π/2 0 0" + Rz(j4))
//                     └─ wrist3 (joint: xyz="0 0.0921 0" rpy="π/2 π π" + Rz(j5))
//
// The viewer uses Y-up, but the URDF uses Z-up.
// We prepend a -90° X rotation to align URDF Z-up → Three.js Y-up.
function urdfFK(joints, THREE) {
  // Align URDF Z-up to Three.js Y-up
  const base = new THREE.Matrix4().makeRotationX(-PI / 2);

  // Fixed joint: base_link → base_link_inertia (rotate π around Z)
  let T = mul(base, compose(THREE, 0, 0, 0,  0, 0, PI));
  const f0 = T.clone(); // base_link_inertia

  // shoulder_pan_joint
  T = mul(T, mul(compose(THREE, 0, 0, 0.15185,  0, 0, 0), rotZ(THREE, joints[0])));
  const f1 = T.clone(); // shoulder_link

  // shoulder_lift_joint
  T = mul(T, mul(compose(THREE, 0, 0, 0,  PI/2, 0, 0), rotZ(THREE, joints[1])));
  const f2 = T.clone(); // upper_arm_link

  // elbow_joint
  T = mul(T, mul(compose(THREE, -0.24355, 0, 0,  0, 0, 0), rotZ(THREE, joints[2])));
  const f3 = T.clone(); // forearm_link

  // wrist_1_joint
  T = mul(T, mul(compose(THREE, -0.2132, 0, 0.13105,  0, 0, 0), rotZ(THREE, joints[3])));
  const f4 = T.clone(); // wrist_1_link

  // wrist_2_joint
  T = mul(T, mul(compose(THREE, 0, -0.08535, 0,  PI/2, 0, 0), rotZ(THREE, joints[4])));
  const f5 = T.clone(); // wrist_2_link

  // wrist_3_joint
  T = mul(T, mul(compose(THREE, 0, 0.0921, 0,  PI/2, PI, PI), rotZ(THREE, joints[5])));
  const f6 = T.clone(); // wrist_3_link

  return [f0, f1, f2, f3, f4, f5, f6];
}

// ── DH FK (for TCP only) ────────────────────────────────────
function dhFK(joints, THREE) {
  let T = new THREE.Matrix4().makeRotationX(-PI / 2);
  const out = [T.clone()];
  for (let i = 0; i < 6; i++) {
    const ct = Math.cos(joints[i]), st = Math.sin(joints[i]);
    const ca = Math.cos(DH.alpha[i]), sa = Math.sin(DH.alpha[i]);
    const a = DH.a[i], d = DH.d[i];
    const Ti = new THREE.Matrix4().set(
      ct, -st*ca,  st*sa, a*ct,
      st,  ct*ca, -ct*sa, a*st,
       0,     sa,     ca,    d,
       0,      0,      0,    1
    );
    T = mul(T, Ti);
    out.push(T.clone());
  }
  return out;
}

// TCP offset: UR rotation-vector convention
function tcpOffsetMatrix(offset, THREE) {
  const { x=0, y=0, z=0, rx=0, ry=0, rz=0 } = offset;
  const angle = Math.sqrt(rx*rx + ry*ry + rz*rz);
  const q = new THREE.Quaternion();
  if (angle > 1e-9) q.setFromAxisAngle(new THREE.Vector3(rx/angle, ry/angle, rz/angle), angle);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  m.setPosition(x, y, z);
  return m;
}

// ── URDF mesh visual origins ────────────────────────────────
// From <visual><origin> in ur3e.urdf — applied as local offset inside each link frame
const MESH_ORIGINS = [
  [0, 0, 0,      0,    0,   PI  ],  // base
  [0, 0, 0,      0,    0,   PI  ],  // shoulder
  [0, 0, 0.12,   PI/2, 0,  -PI/2], // upperarm
  [0, 0, 0.027,  PI/2, 0,  -PI/2], // forearm
  [0, 0, -0.104, PI/2, 0,   0   ],  // wrist1
  [0, 0, -0.08535, 0,  0,   0   ],  // wrist2
  [0, 0, -0.0921,PI/2, 0,   0   ],  // wrist3
];

const MESH_NAMES  = ['base','shoulder','upperarm','forearm','wrist1','wrist2','wrist3'];
const MESH_URL    = 'https://nwenzel28.github.io/ur-arms/meshes/ur3e/';

// ── Scene state ─────────────────────────────────────────────
let scene, camera, renderer, orbitControls;
let meshPivots    = [];   // one Group per link (pivot = link frame, child = mesh with origin offset)
let tcpMesh       = null;
let tcpAxesGroup  = null;
let flangeMarker  = null;
let offsetLine    = null;
let THREE         = null;
let OC            = null;
let _lastJoints   = [0, -PI/2, 0, -PI/2, -PI/2, 0];
let _meshesReady  = false;

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
  scene.add(Object.assign(new THREE.DirectionalLight(0x6688cc, 0.30), {
    position: new THREE.Vector3(-1.0, 0.6, -1.2)
  }));

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
    new THREE.MeshStandardMaterial({
      color: 0x60a5fa, roughness: 0.25, metalness: 0.75,
      emissive: 0x60a5fa, emissiveIntensity: 0.18
    })
  );
  scene.add(tcpMesh);

  // ── TCP axis lines ──
  tcpAxesGroup = new THREE.Group();
  [[1,0,0,0xef4444],[0,1,0,0x22c55e],[0,0,1,0x60a5fa]].forEach(([x,y,z,c]) => {
    tcpAxesGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0,0,0), new THREE.Vector3(x,y,z).multiplyScalar(0.055)
      ]),
      new THREE.LineBasicMaterial({ color: c })
    ));
  });
  scene.add(tcpAxesGroup);

  // ── Flange ring ──
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

  showLoadingOverlay(container);
  await loadScript(
    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/ColladaLoader.js',
    () => window.THREE.ColladaLoader
  );
  await loadAllMeshes();
  hideLoadingOverlay(container);
  updateViewer(_lastJoints);
}

// ── Load all 7 .dae meshes ──────────────────────────────────
function loadAllMeshes() {
  const loader = new THREE.ColladaLoader();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb2b2b7, roughness: 0.55, metalness: 0.35
  });

  const promises = MESH_NAMES.map((name, i) => new Promise(resolve => {
    loader.load(
      MESH_URL + name + '.dae',
      (collada) => {
        const obj = collada.scene;
        obj.traverse(child => {
          if (child.isMesh) {
            child.material = mat.clone();
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Apply the URDF mesh visual origin inside the obj
        const [x, y, z, rx, ry, rz] = MESH_ORIGINS[i];
        const originMat = compose(THREE, x, y, z, rx, ry, rz);
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        originMat.decompose(p, q, s);
        obj.position.copy(p);
        obj.quaternion.copy(q);

        // Pivot group: position/quaternion will be set to the URDF link frame each update
        const pivot = new THREE.Group();
        pivot.add(obj);
        meshPivots[i] = pivot;
        scene.add(pivot);
        resolve();
      },
      undefined,
      (err) => {
        console.warn(`Could not load ${name}.dae`, err);
        meshPivots[i] = new THREE.Group();
        scene.add(meshPivots[i]);
        resolve();
      }
    );
  }));

  return Promise.all(promises).then(() => { _meshesReady = true; });
}

// ── Public: update ──────────────────────────────────────────
export function updateViewer(joints, tcpOffset = null) {
  if (!THREE || !scene) return;
  if (joints) _lastJoints = joints;
  if (!_meshesReady) return;

  // Place each mesh pivot at its URDF link frame
  const linkFrames = urdfFK(_lastJoints, THREE);
  for (let i = 0; i < 7; i++) {
    if (!meshPivots[i]) continue;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    linkFrames[i].decompose(p, q, s);
    meshPivots[i].position.copy(p);
    meshPivots[i].quaternion.copy(q);
  }

  // TCP via DH FK
  const dhFrames  = dhFK(_lastJoints, THREE);
  const flangePos = new THREE.Vector3().setFromMatrixPosition(dhFrames[6]);
  const flangeQuat = new THREE.Quaternion();
  dhFrames[6].decompose(new THREE.Vector3(), flangeQuat, new THREE.Vector3());

  let tcpPos  = flangePos.clone();
  let tcpQuat = flangeQuat.clone();

  if (tcpOffset) {
    const tcpMat = mul(dhFrames[6], tcpOffsetMatrix(tcpOffset, THREE));
    tcpMat.decompose(tcpPos, tcpQuat, new THREE.Vector3());
  }

  tcpMesh.position.copy(tcpPos);
  tcpMesh.quaternion.copy(tcpQuat);
  tcpAxesGroup.position.copy(tcpPos);
  tcpAxesGroup.quaternion.copy(tcpQuat);

  const hasOffset = tcpOffset &&
    (Math.abs(tcpOffset.x)+Math.abs(tcpOffset.y)+Math.abs(tcpOffset.z)+
     Math.abs(tcpOffset.rx)+Math.abs(tcpOffset.ry)+Math.abs(tcpOffset.rz)) > 1e-6;

  if (flangeMarker) {
    flangeMarker.visible = !!hasOffset;
    if (hasOffset) {
      flangeMarker.position.copy(flangePos);
      flangeMarker.quaternion.copy(flangeQuat);
    }
  }
  updateOffsetLine(flangePos, tcpPos, !!hasOffset);
}

// ── Utilities ────────────────────────────────────────────────
function updateOffsetLine(from, to, visible) {
  if (!offsetLine) return;
  offsetLine.visible = visible;
  if (!visible) return;
  const attr = offsetLine.geometry.attributes.position;
  if (attr) {
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
  } else {
    offsetLine.geometry.setFromPoints([from.clone(), to.clone()]);
  }
}

function sizeRenderer(container) {
  if (!renderer || !camera) return;
  const w = container.clientWidth, h = container.clientHeight || 380;
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
  container.querySelector('#viewer-loading')?.remove();
}