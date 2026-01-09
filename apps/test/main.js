// Copyright (c) 2025 naruya
// SubScene Test - Check if GVRM works correctly when added to a subscene

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GVRM, GVRMUtils } from '../../gvrm-format/gvrm.js';

// UI
const container = document.getElementById('threejs-container');
let width = window.innerWidth;
let height = window.innerHeight;

// renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
container.appendChild(renderer.domElement);
renderer.setSize(width, height);

// camera
const camera = new THREE.PerspectiveCamera(65.0, width / height, 0.01, 2000.0);
camera.position.set(3.0, 2.0, 6.0);
camera.updateProjectionMatrix();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1.5, 1.0, 0.0);
controls.update();

// main scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

// lights
const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(10.0, 10.0, 10.0);
scene.add(light);
scene.add(new THREE.AmbientLight(0x404040));

// grid
const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x444444);
scene.add(gridHelper);

// axes at origin (main scene)
const mainAxes = new THREE.AxesHelper(1);
mainAxes.material.linewidth = 3;
scene.add(mainAxes);

// Create subscene (THREE.Group) at offset position
const subScene = new THREE.Group();
subScene.position.set(3, 0, 0);  // offset from origin
scene.add(subScene);

// axes for subscene (green-ish)
const subAxes = new THREE.AxesHelper(1);
subScene.add(subAxes);


// GVRM instances
let gvrmMain = null;  // GVRM in main scene
let gvrmSub = null;   // GVRM in subscene

const gvrmFile = '../../assets/sample1.gvrm';
const fbxFile = '../../assets/Idle.fbx';

const statusText = document.getElementById('status-text');

function updateStatus() {
  if (!gvrmMain || !gvrmSub) {
    statusText.textContent = 'Loading...';
    return;
  }

  const mainVrm = gvrmMain.character.currentVrm.scene;
  const subVrm = gvrmSub.character.currentVrm.scene;

  // Get local positions
  const mainLocalPos = mainVrm.position.clone();
  const subLocalPos = subVrm.position.clone();

  // Get world positions
  const mainWorldPos = new THREE.Vector3();
  const subWorldPos = new THREE.Vector3();
  mainVrm.getWorldPosition(mainWorldPos);
  subVrm.getWorldPosition(subWorldPos);

  // Get stored position0 values
  const mainPos0 = mainVrm.position0 || new THREE.Vector3();
  const subPos0 = subVrm.position0 || new THREE.Vector3();

  // GS viewer positions
  const mainGsPos = gvrmMain.gs.viewer.position.clone();
  const subGsPos = gvrmSub.gs.viewer.position.clone();

  // SubScene position
  const subScenePos = subScene.position.clone();
  const subSceneRot = subScene.rotation.clone();

  statusText.textContent = `
=== Main Scene GVRM ===
VRM local pos:  (${mainLocalPos.x.toFixed(2)}, ${mainLocalPos.y.toFixed(2)}, ${mainLocalPos.z.toFixed(2)})
VRM world pos:  (${mainWorldPos.x.toFixed(2)}, ${mainWorldPos.y.toFixed(2)}, ${mainWorldPos.z.toFixed(2)})
VRM position0:  (${mainPos0.x.toFixed(2)}, ${mainPos0.y.toFixed(2)}, ${mainPos0.z.toFixed(2)})
GS viewer pos:  (${mainGsPos.x.toFixed(2)}, ${mainGsPos.y.toFixed(2)}, ${mainGsPos.z.toFixed(2)})

=== SubScene GVRM ===
SubScene pos:   (${subScenePos.x.toFixed(2)}, ${subScenePos.y.toFixed(2)}, ${subScenePos.z.toFixed(2)})
SubScene rot Y: ${(subSceneRot.y * 180 / Math.PI).toFixed(1)}°
VRM local pos:  (${subLocalPos.x.toFixed(2)}, ${subLocalPos.y.toFixed(2)}, ${subLocalPos.z.toFixed(2)})
VRM world pos:  (${subWorldPos.x.toFixed(2)}, ${subWorldPos.y.toFixed(2)}, ${subWorldPos.z.toFixed(2)})
VRM position0:  (${subPos0.x.toFixed(2)}, ${subPos0.y.toFixed(2)}, ${subPos0.z.toFixed(2)})
GS viewer pos:  (${subGsPos.x.toFixed(2)}, ${subGsPos.y.toFixed(2)}, ${subGsPos.z.toFixed(2)})

=== Expected vs Actual ===
SubScene GVRM should appear at world pos (${subScenePos.x.toFixed(2)}, 0, 0)
GS viewer should track VRM movement correctly
`.trim();
}

async function loadModels() {
  // Load GVRM into main scene (normal case)
  console.log('Loading GVRM into main scene...');
  gvrmMain = await GVRM.load(gvrmFile, scene, camera, renderer, 'main');
  await gvrmMain.changeFBX(fbxFile);
  gvrmMain.character.currentVrm.scene.position.set(0, 0, 0);
  console.log('Main scene GVRM loaded');

  // Load GVRM into subscene (test case)
  console.log('Loading GVRM into subscene...');
  gvrmSub = await GVRM.load(gvrmFile, subScene, camera, renderer, 'sub');
  await gvrmSub.changeFBX(fbxFile);
  gvrmSub.character.currentVrm.scene.position.set(0, 0, 0);  // local position in subscene
  console.log('SubScene GVRM loaded');

  document.getElementById('loaddisplay').textContent = '100%';
}

loadModels();

// UI controls
let stateAnim = 'play';

document.getElementById('move-subscene').addEventListener('click', () => {
  // Move subscene to test if GVRM follows
  subScene.position.x += 1;
  if (subScene.position.x > 6) {
    subScene.position.x = 0;
  }
  console.log('SubScene moved to:', subScene.position.x);
});

document.getElementById('rotate-subscene').addEventListener('click', () => {
  // Rotate subscene to test if GVRM follows
  subScene.rotation.y += Math.PI / 4;
  console.log('SubScene rotated to:', subScene.rotation.y * 180 / Math.PI, 'degrees');
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    if (stateAnim === 'play') {
      stateAnim = 'pause';
      if (gvrmMain?.character?.action) gvrmMain.character.action.stop();
      if (gvrmSub?.character?.action) gvrmSub.character.action.stop();
    } else {
      stateAnim = 'play';
      if (gvrmMain?.character?.action) {
        gvrmMain.character.action.reset();
        gvrmMain.character.action.play();
      }
      if (gvrmSub?.character?.action) {
        gvrmSub.character.action.reset();
        gvrmSub.character.action.play();
      }
    }
  }

  if (event.code === 'KeyD') {
    // Debug log
    console.log('=== Debug Info ===');
    console.log('gvrmMain:', gvrmMain);
    console.log('gvrmSub:', gvrmSub);
    console.log('subScene:', subScene);
    console.log('subScene.matrixWorld:', subScene.matrixWorld.elements);
  }
});

window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});

function animate() {
  if (gvrmMain?.isReady) {
    gvrmMain.update();
  }
  if (gvrmSub?.isReady) {
    gvrmSub.update();
  }

  updateStatus();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
