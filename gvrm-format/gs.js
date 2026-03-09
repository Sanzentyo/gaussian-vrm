// Copyright (c) 2025 naruya
// Licensed under the MIT License. See LICENSE file in the project root for full license information.


import * as THREE from 'three';
import { PackedSplats, SparkRenderer, SplatMesh, SplatSkinning } from '@sparkjsdev/spark';


const tempCenter = new THREE.Vector3();
const tempScales = new THREE.Vector3();
const tempColor = new THREE.Color();
const tempQuat = new THREE.Quaternion();
const tempVertex = new THREE.Vector3();
const tempRelativePos = new THREE.Vector3();
const tempBonePos = new THREE.Vector3();
const tempBoneQuat = new THREE.Quaternion();
const tempRootQuat = new THREE.Quaternion();
const tempRootQuatInverse = new THREE.Quaternion();
const tempRootInverse = new THREE.Matrix4();
const tempBoneIndices = new THREE.Vector4();
const tempBoneWeights = new THREE.Vector4();


function ensureSparkRenderer(scene, renderer) {
  if (!scene.userData.sparkRenderer) {
    const sparkRenderer = new SparkRenderer({
      renderer,
    });
    sparkRenderer.name = 'SparkRenderer';
    sparkRenderer.frustumCulled = false;
    scene.add(sparkRenderer);
    scene.userData.sparkRenderer = sparkRenderer;
  }
  return scene.userData.sparkRenderer;
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


async function loadPackedSplats(urls) {
  if (!Array.isArray(urls)) {
    urls = [urls];
  }

  const filteredUrls = urls.filter(Boolean);
  if (filteredUrls.length === 0) {
    throw new Error('No Gaussian splat URLs were provided.');
  }

  if (filteredUrls.length === 1) {
    const packedSplats = new PackedSplats({ url: filteredUrls[0] });
    await packedSplats.initialized;
    return packedSplats;
  }

  const mergedSplats = new PackedSplats();
  for (const url of filteredUrls) {
    const packedSplats = new PackedSplats({ url });
    await packedSplats.initialized;
    packedSplats.forEachSplat((_index, center, scales, quaternion, opacity, color) => {
      mergedSplats.pushSplat(center, scales, quaternion, opacity, color);
    });
  }
  mergedSplats.needsUpdate = true;
  return mergedSplats;
}


class SparkViewer extends THREE.Group {
  constructor(scene, renderer) {
    super();
    this.loadingSpinner = createLoadingSpinner();
    this.sparkRenderer = ensureSparkRenderer(scene, renderer);
    this.sparkScene = new THREE.Group();
    this.sparkScene.name = 'SparkSplatScene';
    this.add(this.sparkScene);
  }

  getSplatScene(index) {
    return index === 0 ? this.sparkScene : undefined;
  }

  async dispose() {
    const gsGroup = this.parent;

    if (this.sparkMesh) {
      if (this.sparkMesh.parent) {
        this.sparkMesh.parent.remove(this.sparkMesh);
      }
      this.sparkMesh.dispose();
      this.sparkMesh = null;
      this.splatMesh = null;
    }

    if (this.parent) {
      this.parent.remove(this);
    }
    if (gsGroup && gsGroup.parent) {
      gsGroup.parent.remove(gsGroup);
    }
  }
}


export class GaussianSplatting extends THREE.Group {
  constructor(urls, scale, gsPosition, quaternion, scene, renderer) {
    super();
    this.sparkRenderer = ensureSparkRenderer(scene, renderer);
    this.splatCount = 0;
    this.sourcePosition = new THREE.Vector3();
    this.sourceQuaternion = new THREE.Quaternion();
    this.loadGS(urls, scale, gsPosition, quaternion, scene, renderer);
  }

  rebuildBaseDataCaches() {
    this.splatCount = this.sparkMesh.packedSplats.numSplats;
    this.centers = new Float32Array(this.splatCount * 3);
    this.colors = new Float32Array(this.splatCount * 4);
    this.scales = new Float32Array(this.splatCount * 3);
    this.quaternions = new Float32Array(this.splatCount * 4);
    this.covariances = new Float32Array(this.splatCount * 6);

    this.sparkMesh.forEachSplat((index, center, scales, quaternion, opacity, color) => {
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

    this.centers0 = new Float32Array(this.centers);
    this.colors0 = new Float32Array(this.colors);
    this.covariances0 = new Float32Array(this.covariances);
  }

  syncRange(startIndex = 0, endIndex = this.splatCount - 1) {
    if (!this.sparkMesh) return;

    const start = Math.max(0, startIndex);
    const end = Math.min(this.splatCount - 1, endIndex);
    if (end < start) return;

    for (let i = start; i <= end; i++) {
      tempCenter.set(
        this.centers[i * 3 + 0],
        this.centers[i * 3 + 1],
        this.centers[i * 3 + 2]
      );
      tempScales.set(
        this.scales[i * 3 + 0],
        this.scales[i * 3 + 1],
        this.scales[i * 3 + 2]
      );
      tempQuat.set(
        this.quaternions[i * 4 + 0],
        this.quaternions[i * 4 + 1],
        this.quaternions[i * 4 + 2],
        this.quaternions[i * 4 + 3]
      );
      tempColor.setRGB(
        this.colors[i * 4 + 0] / 255.0,
        this.colors[i * 4 + 1] / 255.0,
        this.colors[i * 4 + 2] / 255.0
      );

      const opacity = THREE.MathUtils.clamp(this.colors[i * 4 + 3] / 255.0, 0.0, 1.0);
      this.sparkMesh.packedSplats.setSplat(i, tempCenter, tempScales, tempQuat, opacity, tempColor);
    }

    this.sparkMesh.packedSplats.needsUpdate = true;
  }

  async applyCharacterSkinning(character, splatVertexIndices, splatRelativePoses) {
    const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];
    const skeleton = skinnedMesh.skeleton;
    const positionAttribute = skinnedMesh.geometry.getAttribute('position');
    const skinIndexAttribute = skinnedMesh.geometry.getAttribute('skinIndex');
    const skinWeightAttribute = skinnedMesh.geometry.getAttribute('skinWeight');

    this.sourcePosition.copy(this.sceneTransform.position);
    this.sourceQuaternion.copy(this.sceneTransform.quaternion);

    const skinning = new SplatSkinning({
      mesh: this.sparkMesh,
      numSplats: this.splatCount,
      numBones: Math.min(256, skeleton.bones.length),
    });

    character.currentVrm.scene.updateMatrixWorld(true);
    tempRootInverse.copy(character.currentVrm.scene.matrixWorld).invert();
    character.currentVrm.scene.getWorldQuaternion(tempRootQuat);
    tempRootQuatInverse.copy(tempRootQuat).invert();

    for (let boneIndex = 0; boneIndex < skinning.numBones; boneIndex++) {
      const bone = skeleton.bones[boneIndex];
      bone.getWorldPosition(tempBonePos);
      tempBonePos.applyMatrix4(tempRootInverse);
      bone.getWorldQuaternion(tempBoneQuat);
      tempBoneQuat.premultiply(tempRootQuatInverse);
      skinning.setRestQuatPos(boneIndex, tempBoneQuat, tempBonePos);
      skinning.setBoneQuatPos(boneIndex, tempBoneQuat, tempBonePos);
    }

    for (let i = 0; i < this.splatCount; i++) {
      const vertexIndex = splatVertexIndices[i];
      tempVertex.fromBufferAttribute(positionAttribute, vertexIndex);
      skinnedMesh.applyBoneTransform(vertexIndex, tempVertex);

      tempRelativePos.set(
        splatRelativePoses[i * 3 + 0],
        splatRelativePoses[i * 3 + 1],
        splatRelativePoses[i * 3 + 2]
      );
      tempCenter.copy(tempVertex).add(tempRelativePos);

      tempBoneIndices.set(
        skinIndexAttribute.getX(vertexIndex),
        skinIndexAttribute.getY(vertexIndex),
        skinIndexAttribute.getZ(vertexIndex),
        skinIndexAttribute.getW(vertexIndex)
      );
      tempBoneWeights.set(
        skinWeightAttribute.getX(vertexIndex),
        skinWeightAttribute.getY(vertexIndex),
        skinWeightAttribute.getZ(vertexIndex),
        skinWeightAttribute.getW(vertexIndex)
      );

      const totalWeight = tempBoneWeights.x + tempBoneWeights.y + tempBoneWeights.z + tempBoneWeights.w;
      if (totalWeight <= 0.0) {
        tempBoneIndices.set(0, 0, 0, 0);
        tempBoneWeights.set(1, 0, 0, 0);
      }

      skinning.setSplatBones(i, tempBoneIndices, tempBoneWeights);

      const splat = this.sparkMesh.packedSplats.getSplat(i);
      this.sparkMesh.packedSplats.setSplat(
        i,
        tempCenter,
        splat.scales,
        splat.quaternion,
        splat.opacity,
        splat.color
      );
    }

    this.sceneTransform.position.set(0, 0, 0);
    this.sceneTransform.quaternion.identity();
    this.sceneTransform.scale.setScalar(1);
    this.sceneTransform.updateMatrixWorld(true);

    this.sparkMesh.skinning = skinning;
    this.sparkMesh.updateGenerator();
    this.sparkMesh.needsUpdate = true;
    this.sparkMesh.packedSplats.needsUpdate = true;
    this.skinning = skinning;
    this.rebuildBaseDataCaches();
  }

  updateSkinningFromCharacter(character) {
    if (!this.skinning) return;

    const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];
    const skeleton = skinnedMesh.skeleton;

    character.currentVrm.scene.updateMatrixWorld(true);
    tempRootInverse.copy(character.currentVrm.scene.matrixWorld).invert();
    character.currentVrm.scene.getWorldQuaternion(tempRootQuat);
    tempRootQuatInverse.copy(tempRootQuat).invert();

    const boneCount = Math.min(this.skinning.numBones, skeleton.bones.length);
    for (let boneIndex = 0; boneIndex < boneCount; boneIndex++) {
      const bone = skeleton.bones[boneIndex];
      bone.getWorldPosition(tempBonePos);
      tempBonePos.applyMatrix4(tempRootInverse);
      bone.getWorldQuaternion(tempBoneQuat);
      tempBoneQuat.premultiply(tempRootQuatInverse);
      this.skinning.setBoneQuatPos(boneIndex, tempBoneQuat, tempBonePos);
    }

    this.skinning.updateBones();
  }

  loadGS(urls, scale, gsPosition = [0, 0, 0], quaternion = [0, 0, 1, 0], scene, renderer) {
    this.loadingPromise = (async () => {
      const viewer = new SparkViewer(scene, renderer);
      const packedSplats = await loadPackedSplats(urls);
      const sparkMesh = new SplatMesh({ packedSplats });
      await sparkMesh.initialized;

      viewer.sparkMesh = sparkMesh;
      viewer.splatMesh = sparkMesh;
      viewer.sparkScene.add(sparkMesh);

      const sceneTransform = viewer.sparkScene;
      sceneTransform.position.set(...gsPosition);
      sceneTransform.quaternion.set(...quaternion);
      sceneTransform.scale.setScalar(scale);
      sceneTransform.updateMatrixWorld(true);

      this.splatCount = sparkMesh.packedSplats.numSplats;
      sparkMesh.scenes = [sceneTransform];
      sparkMesh.pointCloudModeEnabled = false;
      sparkMesh.updateDataTexturesFromBaseData = (startIndex = 0, endIndex = this.splatCount - 1) => {
        this.syncRange(startIndex, endIndex);
      };
      sparkMesh.setPointCloudModeEnabled = (enabled) => {
        sparkMesh.pointCloudModeEnabled = enabled;
        this.sparkRenderer.maxStdDev = enabled ? 0.35 : Math.sqrt(8.0);
        this.sparkRenderer.falloff = enabled ? 0.0 : 1.0;
      };

      this.viewer = viewer;
      this.sparkMesh = sparkMesh;
      this.splatMesh = sparkMesh;
      this.sceneTransform = sceneTransform;
      this.sourcePosition.set(...gsPosition);
      this.sourceQuaternion.set(...quaternion);

      this.add(viewer);
      this.position0 = new THREE.Vector3(...gsPosition);
      this.quaternion0 = new THREE.Quaternion(...quaternion);
      this.rotation0 = new THREE.Euler().setFromQuaternion(this.quaternion0);
      this.matrix0 = new THREE.Matrix4().compose(this.position0, this.quaternion0, new THREE.Vector3(1, 1, 1));

      this.rebuildBaseDataCaches();
      return this;
    })();
  }
}
