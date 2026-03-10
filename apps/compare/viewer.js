import * as THREE from 'three';
import { GVRM, GVRMUtils } from 'gvrm';
import { applyScenarioPose, ASSET_PATH, CAMERA_CONFIG, SCENARIO_NAMES } from './poses.js';


const mode = window.__COMPARE_MODE ?? 'unknown';
const searchParams = new URL(window.location.href).searchParams;
const gvrmLoadOptions = {
  ...(window.__COMPARE_GVRM_OPTIONS ?? {}),
  ...(searchParams.has('sparkSkinning')
    ? { sparkSkinning: searchParams.get('sparkSkinning') !== '0' }
    : {}),
};
const canvas = document.getElementById('canvas');
const label = document.getElementById('scenario-label');
const rendererLabel = document.getElementById('renderer-label');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(CAMERA_CONFIG.width, CAMERA_CONFIG.height, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  CAMERA_CONFIG.fov,
  CAMERA_CONFIG.width / CAMERA_CONFIG.height,
  CAMERA_CONFIG.near,
  CAMERA_CONFIG.far,
);
camera.position.set(...CAMERA_CONFIG.position);
camera.lookAt(...CAMERA_CONFIG.target);

const keyLight = new THREE.DirectionalLight(0xffffff, Math.PI * 1.1);
keyLight.position.set(1.2, 1.6, 2.2);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, Math.PI * 0.35);
fillLight.position.set(-1.4, 0.8, 1.5);
scene.add(fillLight);

scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.2));


function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function renderNow() {
  renderer.render(scene, camera);
}

async function waitForSparkIdle(gvrm) {
  const defaultView = gvrm.gs.sparkRenderer?.defaultView;
  if (!defaultView) return;

  for (let attempt = 0; attempt < 120; attempt++) {
    if (!defaultView.sortingCheck) {
      return;
    }
    await nextFrame();
  }
}

async function settleScenario(gvrm, frames) {
  for (let i = 0; i < frames; i++) {
    await waitForSparkIdle(gvrm);
    gvrm.update();
    renderNow();
    if (i < frames - 1) {
      await nextFrame();
    }
  }
}

async function settleSparkView(gvrm) {
  const prepare = gvrm.gs.sparkRenderer?.defaultView?.prepare?.bind(gvrm.gs.sparkRenderer.defaultView);
  if (!prepare) return;

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await waitForSparkIdle(gvrm);
      await prepare({
        scene,
        camera,
        update: true,
        forceOrigin: true,
      });
      renderNow();
      return;
    } catch (error) {
      if (!String(error?.message ?? error).includes('Only one sort at a time')) {
        throw error;
      }
      await nextFrame();
    }
  }

  throw new Error('Spark sorting did not settle after repeated retries.');
}

function resetPose(gvrm) {
  GVRMUtils.resetPose(gvrm.character, gvrm.boneOperations);
  gvrm.character.currentVrm.scene.updateMatrixWorld(true);
}

function configureLocalSpark(gvrm) {
  const sparkRenderer = gvrm.gs.sparkRenderer;
  if (!sparkRenderer) return;

  sparkRenderer.autoUpdate = false;
  sparkRenderer.defaultView?.setAutoUpdate(false);
}

async function main() {
  const gvrm = await GVRM.load(ASSET_PATH, scene, camera, renderer, 'sample1.gvrm', gvrmLoadOptions);
  if (mode === 'local') {
    configureLocalSpark(gvrm);
  }
  if (rendererLabel && gvrm.sparkSkinning) {
    rendererLabel.textContent = `${mode} + spark skinning`;
  }

  async function applyScenario(name = 'neutral', attempt = 0) {
    try {
      resetPose(gvrm);
      const scenario = applyScenarioPose(gvrm, name);
      await settleScenario(gvrm, 2);
      if (mode === 'local') {
        await settleSparkView(gvrm);
      }
      renderNow();
      label.textContent = scenario.label;
      window.__compare__.currentScenario = name;
      return scenario.label;
    } catch (error) {
      if (
        mode === 'local' &&
        attempt < 30 &&
        String(error?.message ?? error).includes('Only one sort at a time')
      ) {
        await nextFrame();
        return applyScenario(name, attempt + 1);
      }
      throw error;
    }
  }

  window.__compare__ = {
    mode,
    gvrm,
    renderer,
    scene,
    camera,
    scenarioNames: SCENARIO_NAMES,
    currentScenario: null,
    applyScenario,
  };

  const params = new URL(window.location.href).searchParams;
  await applyScenario(params.get('scenario') ?? 'neutral');
  renderNow();
  document.body.dataset.ready = 'true';
}

main().catch((error) => {
  console.error(error);
  document.body.dataset.ready = 'error';
  document.body.dataset.error = error.message;
});
