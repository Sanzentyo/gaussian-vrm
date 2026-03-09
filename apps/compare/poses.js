export const ASSET_PATH = '../../assets/sample1.gvrm';

export const CAMERA_CONFIG = {
  width: 640,
  height: 640,
  fov: 65,
  near: 0.01,
  far: 100,
  position: [0, 0.4, 1.5],
  target: [0, 0.45, 0],
};

export const SCENARIOS = {
  neutral: {
    label: 'Neutral',
    rotations: {},
  },
  'left-arm-bend': {
    label: 'Left arm bend',
    rotations: {
      leftUpperArm: { z: -42, x: 12 },
      leftLowerArm: { z: -68 },
      leftHand: { z: -12 },
    },
  },
  'right-arm-bend': {
    label: 'Right arm bend',
    rotations: {
      rightUpperArm: { z: 42, x: 12 },
      rightLowerArm: { z: 68 },
      rightHand: { z: 12 },
    },
  },
  'both-arms-forward': {
    label: 'Both arms forward',
    rotations: {
      leftUpperArm: { x: 34, z: -18 },
      leftLowerArm: { x: -58 },
      rightUpperArm: { x: 34, z: 18 },
      rightLowerArm: { x: -58 },
    },
  },
  'crouch-twist': {
    label: 'Crouch + twist',
    rotations: {
      spine: { y: 12 },
      chest: { y: 18 },
      upperChest: { y: 12 },
      leftUpperLeg: { x: 34 },
      leftLowerLeg: { x: -48 },
      rightUpperLeg: { x: 34 },
      rightLowerLeg: { x: -48 },
      leftUpperArm: { z: -16 },
      rightUpperArm: { z: 16 },
    },
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

function degToRad(value = 0) {
  return value * Math.PI / 180.0;
}

export function applyScenarioPose(gvrm, scenarioName) {
  const scenario = SCENARIOS[scenarioName] ?? SCENARIOS.neutral;
  const humanoid = gvrm.character.currentVrm.humanoid;

  for (const [boneName, rotation] of Object.entries(scenario.rotations)) {
    const bone = humanoid.getNormalizedBoneNode(boneName);
    if (!bone) continue;
    bone.rotation.set(
      degToRad(rotation.x ?? 0),
      degToRad(rotation.y ?? 0),
      degToRad(rotation.z ?? 0),
    );
  }

  humanoid.update();
  return scenario;
}
