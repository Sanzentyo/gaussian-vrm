// Copyright (c) 2025 naruya
// Licensed under the MIT License. See LICENSE file in the project root for full license information.


import * as THREE from 'three';
import { PackedSplats, SparkRenderer, SplatMesh, SplatSkinning } from '@sparkjsdev/spark';


const LEGACY_SPHERICAL_HARMONICS_DEGREE = 2;

const tempCenter = new THREE.Vector3();
const tempScales = new THREE.Vector3();
const tempColor = new THREE.Color();
const tempQuat = new THREE.Quaternion();
const tempVertex = new THREE.Vector3();
const tempRelativePos = new THREE.Vector3();
const tempBonePos = new THREE.Vector3();
const tempBoneQuat = new THREE.Quaternion();
const tempGSSceneQuat = new THREE.Quaternion();
const tempGSSceneQuatInverse = new THREE.Quaternion();
const tempGSSceneInverse = new THREE.Matrix4();
const tempMeshMatrix = new THREE.Matrix4();
const tempBoneIndices = new THREE.Vector4();
const tempBoneWeights = new THREE.Vector4();


function configureSparkRenderer(sparkRenderer, scene) {
  if (!sparkRenderer.name) {
    sparkRenderer.name = 'SparkRenderer';
  }
  sparkRenderer.frustumCulled = false;
  if (!sparkRenderer.userData.defaultRenderSettings) {
    sparkRenderer.userData.defaultRenderSettings = {
      maxStdDev: sparkRenderer.maxStdDev,
      minPixelRadius: sparkRenderer.minPixelRadius,
      falloff: sparkRenderer.falloff,
    };
  }
  if (!sparkRenderer.parent) {
    scene.add(sparkRenderer);
  }
  scene.userData.sparkRenderer = sparkRenderer;
  return sparkRenderer;
}


function ensureSparkRenderer(scene, renderer, sparkRenderer = null) {
  if (sparkRenderer) {
    return configureSparkRenderer(sparkRenderer, scene);
  }
  if (!scene.userData.sparkRenderer) {
    scene.userData.sparkRenderer = new SparkRenderer({
      renderer,
    });
  }
  return configureSparkRenderer(scene.userData.sparkRenderer, scene);
}


function normalizeUrls(urls) {
  if (!Array.isArray(urls)) {
    return urls ? [urls] : [];
  }
  return urls.filter(Boolean);
}


async function loadPackedSplats(url) {
  const packedSplats = new PackedSplats({ url });
  await packedSplats.initialized;
  return packedSplats;
}


export function createLoadingSpinner() {
  const activeTasks = new Map();
  const display = document.getElementById('loaddisplay');
  let nextId = 0;

  function renderTasks() {
    if (!display) return;
    display.innerHTML = Array.from(activeTasks.values()).join(' ');
  }

  return {
    addTask(label) {
      const id = `spark-task-${nextId++}`;
      activeTasks.set(id, label);
      renderTasks();
      return id;
    },

    removeTask(id) {
      activeTasks.delete(id);
      renderTasks();
    }
  };
}


class SparkViewer extends THREE.Group {
  constructor(scene, renderer, options = {}) {
    super();
    this.loadingSpinner = createLoadingSpinner();
    this.sparkRenderer = ensureSparkRenderer(scene, renderer, options.sparkRenderer);
    this.sparkScene = new THREE.Group();
    this.sparkScene.name = 'SparkSplatRoot';
    this.sparkScenes = [];
    this.sparkMeshes = [];
    this.add(this.sparkScene);
  }

  getSplatScene(index) {
    return this.sparkScenes[index];
  }

  async dispose() {
    const gsGroup = this.parent;

    for (const sparkMesh of this.sparkMeshes) {
      if (sparkMesh.parent) {
        sparkMesh.parent.remove(sparkMesh);
      }
      sparkMesh.dispose();
    }

    this.sparkScenes = [];
    this.sparkMeshes = [];
    this.sparkMesh = null;
    this.splatMesh = null;

    if (this.parent) {
      this.parent.remove(this);
    }
    if (gsGroup && gsGroup.parent) {
      gsGroup.parent.remove(gsGroup);
    }
  }
}


export class GaussianSplatting extends THREE.Group {
  constructor(urls, scale, gsPosition, quaternion, scene, renderer, options = {}) {
    super();
    this.sparkRenderer = ensureSparkRenderer(scene, renderer, options.sparkRenderer);
    this.sceneEntries = [];
    this.sceneRanges = [];
    this.sparkMeshes = [];
    this.splatCount = 0;
    this.sourcePosition = new THREE.Vector3();
    this.sourceQuaternion = new THREE.Quaternion();
    this.sourceScale = scale;
    this.loadGS(urls, scale, gsPosition, quaternion, scene, renderer, options);
  }

  createCompatSplatMesh() {
    const combinedSplatMesh = {
      scenes: this.sceneEntries.map((entry) => entry.sceneTransform),
      geometry: {
        attributes: {
          splatIndex: {
            array: new Uint32Array(this.splatCount),
          },
        },
      },
      pointCloudModeEnabled: false,
      updateDataTexturesFromBaseData: (startIndex = 0, endIndex = this.splatCount - 1) => {
        this.syncRange(startIndex, endIndex);
      },
      setPointCloudModeEnabled: (enabled) => {
        combinedSplatMesh.pointCloudModeEnabled = enabled;
        this.applyPointCloudMode(enabled);
      },
    };

    Object.defineProperty(combinedSplatMesh, 'renderOrder', {
      get: () => this.sceneEntries[0]?.sparkMesh.renderOrder ?? 0,
      set: (value) => {
        for (const entry of this.sceneEntries) {
          entry.sparkMesh.renderOrder = value;
        }
      },
    });

    return combinedSplatMesh;
  }

  applyPointCloudMode(enabled) {
    const defaultRenderSettings = this.sparkRenderer.userData.defaultRenderSettings;
    this.sparkRenderer.maxStdDev = enabled ? 0.35 : defaultRenderSettings.maxStdDev;
    this.sparkRenderer.falloff = enabled ? 0.0 : defaultRenderSettings.falloff;
    this.sparkRenderer.minPixelRadius = enabled ? 0.0 : defaultRenderSettings.minPixelRadius;

    for (const entry of this.sceneEntries) {
      entry.sparkMesh.pointCloudModeEnabled = enabled;
    }

    if (this.splatMesh) {
      this.splatMesh.pointCloudModeEnabled = enabled;
    }
  }

  rebuildBaseDataCaches() {
    this.splatCount = this.sceneEntries.reduce(
      (count, entry) => count + entry.sparkMesh.packedSplats.numSplats,
      0,
    );

    this.centers = new Float32Array(this.splatCount * 3);
    this.colors = new Float32Array(this.splatCount * 4);
    this.scales = new Float32Array(this.splatCount * 3);
    this.quaternions = new Float32Array(this.splatCount * 4);
    this.covariances = new Float32Array(this.splatCount * 6);
    this.sceneRanges = [];

    let globalIndex = 0;
    for (const entry of this.sceneEntries) {
      const startIndex = globalIndex;
      const count = entry.sparkMesh.packedSplats.numSplats;
      entry.startIndex = startIndex;
      entry.endIndex = startIndex + count - 1;
      this.sceneRanges.push({ startIndex, endIndex: entry.endIndex, entry });

      entry.sparkMesh.forEachSplat((localIndex, center, scales, quaternion, opacity, color) => {
        const index = startIndex + localIndex;

        this.centers[index * 3 + 0] = center.x;
        this.centers[index * 3 + 1] = center.y;
        this.centers[index * 3 + 2] = center.z;

        this.scales[index * 3 + 0] = scales.x;
        this.scales[index * 3 + 1] = scales.y;
        this.scales[index * 3 + 2] = scales.z;

        this.quaternions[index * 4 + 0] = quaternion.x;
        this.quaternions[index * 4 + 1] = quaternion.y;
        this.quaternions[index * 4 + 2] = quaternion.z;
        this.quaternions[index * 4 + 3] = quaternion.w;

        this.colors[index * 4 + 0] = color.r * 255.0;
        this.colors[index * 4 + 1] = color.g * 255.0;
        this.colors[index * 4 + 2] = color.b * 255.0;
        this.colors[index * 4 + 3] = opacity * 255.0;
      });

      globalIndex += count;
    }

    this.centers0 = new Float32Array(this.centers);
    this.colors0 = new Float32Array(this.colors);
    this.covariances0 = new Float32Array(this.covariances);

    if (this.splatMesh) {
      this.splatMesh.scenes = this.sceneEntries.map((entry) => entry.sceneTransform);
      this.splatMesh.geometry.attributes.splatIndex.array = new Uint32Array(this.splatCount);
    }
  }

  syncRange(startIndex = 0, endIndex = this.splatCount - 1) {
    if (!this.sceneEntries.length) return;

    const start = Math.max(0, startIndex);
    const end = Math.min(this.splatCount - 1, endIndex);
    if (end < start) return;

    for (const { startIndex: sceneStart, endIndex: sceneEnd, entry } of this.sceneRanges) {
      if (sceneEnd < start || end < sceneStart) {
        continue;
      }

      const localStart = Math.max(start, sceneStart) - sceneStart;
      const localEnd = Math.min(end, sceneEnd) - sceneStart;

      for (let localIndex = localStart; localIndex <= localEnd; localIndex++) {
        const globalIndex = sceneStart + localIndex;

        tempCenter.set(
          this.centers[globalIndex * 3 + 0],
          this.centers[globalIndex * 3 + 1],
          this.centers[globalIndex * 3 + 2],
        );
        tempScales.set(
          this.scales[globalIndex * 3 + 0],
          this.scales[globalIndex * 3 + 1],
          this.scales[globalIndex * 3 + 2],
        );
        tempQuat.set(
          this.quaternions[globalIndex * 4 + 0],
          this.quaternions[globalIndex * 4 + 1],
          this.quaternions[globalIndex * 4 + 2],
          this.quaternions[globalIndex * 4 + 3],
        );
        tempColor.setRGB(
          this.colors[globalIndex * 4 + 0] / 255.0,
          this.colors[globalIndex * 4 + 1] / 255.0,
          this.colors[globalIndex * 4 + 2] / 255.0,
        );

        const opacity = THREE.MathUtils.clamp(this.colors[globalIndex * 4 + 3] / 255.0, 0.0, 1.0);
        entry.sparkMesh.packedSplats.setSplat(localIndex, tempCenter, tempScales, tempQuat, opacity, tempColor);
      }

      entry.sparkMesh.packedSplats.needsUpdate = true;
      entry.sparkMesh.needsUpdate = true;
    }
  }

  applyScenePivots(scenePivots) {
    if (!scenePivots || !this.sceneEntries.length) return;

    const inverseQuaternion0 = this.quaternion0.clone().invert();
    const pivot = new THREE.Vector3();
    const pivotLocal = new THREE.Vector3();

    for (const [sceneIndexText, pivotValue] of Object.entries(scenePivots)) {
      const sceneIndex = Number(sceneIndexText);
      const entry = this.sceneEntries[sceneIndex];
      if (!entry) continue;

      if (Array.isArray(pivotValue)) {
        pivot.fromArray(pivotValue);
      } else {
        pivot.copy(pivotValue);
      }

      pivotLocal.copy(pivot).sub(this.position0).applyQuaternion(inverseQuaternion0);
      if (this.sourceScale !== 0 && this.sourceScale !== 1) {
        pivotLocal.divideScalar(this.sourceScale);
      }

      entry.sparkMesh.forEachSplat((localIndex, center, scales, quaternion, opacity, color) => {
        tempCenter.copy(center).sub(pivotLocal);
        entry.packedSplats.setSplat(localIndex, tempCenter, scales, quaternion, opacity, color);
      });

      entry.packedSplats.needsUpdate = true;
      entry.sparkMesh.needsUpdate = true;
      entry.sceneTransform.position.copy(pivot);
      entry.sceneTransform.quaternion.copy(this.quaternion0);
      entry.sceneTransform.scale.setScalar(this.sourceScale);
      entry.sceneTransform.updateMatrixWorld(true);
    }

    this.rebuildBaseDataCaches();
  }

  async applyCharacterSkinning(character, splatVertexIndices, splatRelativePoses) {
    const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];
    const skeleton = skinnedMesh.skeleton;
    const positionAttribute = skinnedMesh.geometry.getAttribute('position');
    const skinIndexAttribute = skinnedMesh.geometry.getAttribute('skinIndex');
    const skinWeightAttribute = skinnedMesh.geometry.getAttribute('skinWeight');

    this.sourcePosition.copy(this.sceneTransform.position);
    this.sourceQuaternion.copy(this.sceneTransform.quaternion);

    character.currentVrm.scene.updateMatrixWorld(true);
    skinnedMesh.updateMatrixWorld(true);
    tempMeshMatrix.copy(skinnedMesh.matrixWorld);
    const skinningEntries = [];

    for (const entry of this.sceneEntries) {
      const skinning = new SplatSkinning({
        mesh: entry.sparkMesh,
        numSplats: entry.sparkMesh.packedSplats.numSplats,
        numBones: Math.min(256, skeleton.bones.length),
      });

      entry.sceneTransform.position.copy(this.sourcePosition);
      entry.sceneTransform.quaternion.copy(this.sourceQuaternion);
      entry.sceneTransform.scale.setScalar(this.sourceScale);
      entry.sceneTransform.updateMatrixWorld(true);

      tempGSSceneInverse.copy(entry.sceneTransform.matrixWorld).invert();
      entry.sceneTransform.getWorldQuaternion(tempGSSceneQuat);
      tempGSSceneQuatInverse.copy(tempGSSceneQuat).invert();

      for (let boneIndex = 0; boneIndex < skinning.numBones; boneIndex++) {
        const bone = skeleton.bones[boneIndex];
        bone.getWorldPosition(tempBonePos);
        tempBonePos.applyMatrix4(tempGSSceneInverse);
        bone.getWorldQuaternion(tempBoneQuat);
        tempBoneQuat.premultiply(tempGSSceneQuatInverse);
        skinning.setRestQuatPos(boneIndex, tempBoneQuat, tempBonePos);
        skinning.setBoneQuatPos(boneIndex, tempBoneQuat, tempBonePos);
      }

      const count = entry.sparkMesh.packedSplats.numSplats;
      for (let localIndex = 0; localIndex < count; localIndex++) {
        const globalIndex = entry.startIndex + localIndex;
        const vertexIndex = splatVertexIndices[globalIndex];
        tempVertex.fromBufferAttribute(positionAttribute, vertexIndex);

        tempRelativePos.set(
          splatRelativePoses[globalIndex * 3 + 0],
          splatRelativePoses[globalIndex * 3 + 1],
          splatRelativePoses[globalIndex * 3 + 2],
        );
        tempCenter.copy(tempVertex).add(tempRelativePos);
        tempCenter.applyMatrix4(tempMeshMatrix);
        tempCenter.applyMatrix4(tempGSSceneInverse);

        tempBoneIndices.set(
          skinIndexAttribute.getX(vertexIndex),
          skinIndexAttribute.getY(vertexIndex),
          skinIndexAttribute.getZ(vertexIndex),
          skinIndexAttribute.getW(vertexIndex),
        );
        tempBoneWeights.set(
          skinWeightAttribute.getX(vertexIndex),
          skinWeightAttribute.getY(vertexIndex),
          skinWeightAttribute.getZ(vertexIndex),
          skinWeightAttribute.getW(vertexIndex),
        );

        const totalWeight = tempBoneWeights.x + tempBoneWeights.y + tempBoneWeights.z + tempBoneWeights.w;
        if (totalWeight <= 0.0) {
          tempBoneIndices.set(0, 0, 0, 0);
          tempBoneWeights.set(1, 0, 0, 0);
        }

        skinning.setSplatBones(localIndex, tempBoneIndices, tempBoneWeights);

        const splat = entry.sparkMesh.packedSplats.getSplat(localIndex);
        entry.sparkMesh.packedSplats.setSplat(
          localIndex,
          tempCenter,
          splat.scales,
          splat.quaternion,
          splat.opacity,
          splat.color,
        );
      }

      entry.sparkMesh.skinning = skinning;
      entry.sparkMesh.updateGenerator();
      entry.sparkMesh.needsUpdate = true;
      entry.sparkMesh.packedSplats.needsUpdate = true;
      skinningEntries.push({ skinning, sceneTransform: entry.sceneTransform });
    }

    this.skinning = skinningEntries;
    this.rebuildBaseDataCaches();
  }

  updateSkinningFromCharacter(character) {
    if (!this.skinning) return;

    const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];
    const skeleton = skinnedMesh.skeleton;

    character.currentVrm.scene.updateMatrixWorld(true);
    for (const { skinning, sceneTransform } of this.skinning) {
      sceneTransform.updateMatrixWorld(true);
      tempGSSceneInverse.copy(sceneTransform.matrixWorld).invert();
      sceneTransform.getWorldQuaternion(tempGSSceneQuat);
      tempGSSceneQuatInverse.copy(tempGSSceneQuat).invert();

      const boneCount = Math.min(skinning.numBones, skeleton.bones.length);
      for (let boneIndex = 0; boneIndex < boneCount; boneIndex++) {
        const bone = skeleton.bones[boneIndex];
        bone.getWorldPosition(tempBonePos);
        tempBonePos.applyMatrix4(tempGSSceneInverse);
        bone.getWorldQuaternion(tempBoneQuat);
        tempBoneQuat.premultiply(tempGSSceneQuatInverse);
        skinning.setBoneQuatPos(boneIndex, tempBoneQuat, tempBonePos);
      }

      skinning.updateBones();
    }
  }

  loadGS(urls, scale, gsPosition = [0, 0, 0], quaternion = [0, 0, 1, 0], scene, renderer, options = {}) {
    this.loadingPromise = (async () => {
      const normalizedUrls = normalizeUrls(urls);
      if (normalizedUrls.length === 0) {
        throw new Error('No Gaussian splat URLs were provided.');
      }

      const viewer = new SparkViewer(scene, renderer, options);

      for (const [index, url] of normalizedUrls.entries()) {
        const packedSplats = await loadPackedSplats(url);
        const sparkMesh = new SplatMesh({ packedSplats });
        await sparkMesh.initialized;
        sparkMesh.maxSh = LEGACY_SPHERICAL_HARMONICS_DEGREE;
        sparkMesh.updateGenerator();

        const sceneTransform = new THREE.Group();
        sceneTransform.name = `SparkSplatScene${index}`;
        sceneTransform.position.set(...gsPosition);
        sceneTransform.quaternion.set(...quaternion);
        sceneTransform.scale.setScalar(scale);
        sceneTransform.updateMatrixWorld(true);
        sceneTransform.add(sparkMesh);
        viewer.sparkScene.add(sceneTransform);

        this.sceneEntries.push({ packedSplats, sparkMesh, sceneTransform });
        viewer.sparkScenes.push(sceneTransform);
        viewer.sparkMeshes.push(sparkMesh);
      }

      this.viewer = viewer;
      this.sparkMeshes = this.sceneEntries.map((entry) => entry.sparkMesh);
      this.sparkMesh = this.sparkMeshes[0] ?? null;
      this.sceneTransform = this.sceneEntries[0]?.sceneTransform ?? null;
      this.splatMesh = this.createCompatSplatMesh();
      viewer.sparkMesh = this.sparkMesh;
      viewer.splatMesh = this.splatMesh;

      this.sourcePosition.set(...gsPosition);
      this.sourceQuaternion.set(...quaternion);
      this.sourceScale = scale;

      this.add(viewer);
      this.position0 = new THREE.Vector3(...gsPosition);
      this.quaternion0 = new THREE.Quaternion(...quaternion);
      this.rotation0 = new THREE.Euler().setFromQuaternion(this.quaternion0);
      this.matrix0 = new THREE.Matrix4().compose(this.position0, this.quaternion0, new THREE.Vector3(1, 1, 1));

      this.rebuildBaseDataCaches();
      this.applyPointCloudMode(false);
      return this;
    })();
  }
}
