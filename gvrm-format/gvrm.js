// Copyright (c) 2025 naruya
// Licensed under the MIT License. See LICENSE file in the project root for full license information.


import * as THREE from 'three';
import * as GVRMUtils from './utils.js';
import { VRMCharacter } from './vrm.js';
import { GaussianSplatting } from './gs.js';
import { PLYParser } from './ply.js';
import JSZip from 'jszip'


export class GVRM extends THREE.Group {
  constructor(character, gs) {
    super();
    this.character = character;
    this.gs = gs;
    this.debugAxes = new Map();
    this.isReady = false;
    this.t = 0;
  }

  static async initVRM(vrmPath, scene, camera, renderer, modelScale, boneOperations) {
    if ( !boneOperations ) {
      boneOperations = (await (await fetch("./assets/default.json")).json()).boneOperations;
    }
    if ( !modelScale ) {
      modelScale = 1.0;
    }
    const character = new VRMCharacter(scene, vrmPath, '', modelScale, true);
    await character.loadingPromise;

    character.skinnedMeshIndex = 1;
    character.faceIndex = undefined;
    if (character.currentVrm.scene.children.length > 4) {
      character.skinnedMeshIndex = 2;
      character.faceIndex = 1;
    }

    const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];

    GVRMUtils.visualizeVRM(character, false);

    GVRMUtils.setPose(character, boneOperations);

    // character.currentVrm.scene.updateMatrixWorld(true);
    skinnedMesh.skeleton.update();
    skinnedMesh.skeleton.computeBoneTexture();
    skinnedMesh.geometry.computeVertexNormals();

    if (character.skinnedMeshIndex === 2) {
      const headNode = character.currentVrm.humanoid.getRawBoneNode('head');
      const headTopEndNode = new THREE.Bone();
      headTopEndNode.name = "J_Bip_C_HeadTop_End";
      headTopEndNode.position.set(0, 0.2, -0.05);
      headTopEndNode.updateMatrixWorld(true);
      headNode.add(headTopEndNode);
      skinnedMesh.skeleton.bones.push(headTopEndNode);
      skinnedMesh.bind(new THREE.Skeleton(skinnedMesh.skeleton.bones), skinnedMesh.matrixWorld);
    }
    // call renderer.render after skinnedMesh.bind (?)
    renderer.render(scene, camera);  // ???

    // do not use .clone(), texture.image will be shared unexpectedly
    // const boneTexture0 = skinnedMesh.skeleton.boneTexture.clone();
    skinnedMesh.bindMatrix0 = skinnedMesh.bindMatrix.clone();
    skinnedMesh.bindMatrixInverse0 = skinnedMesh.bindMatrixInverse.clone();

    const widthtex = skinnedMesh.skeleton.boneTexture.image.width;
    const heighttex = skinnedMesh.skeleton.boneTexture.image.height;
    const format = skinnedMesh.skeleton.boneTexture.format;
    const type = skinnedMesh.skeleton.boneTexture.type;
    const dataCopy = skinnedMesh.skeleton.boneTexture.image.data.slice();
    skinnedMesh.boneTexture0 = new THREE.DataTexture(dataCopy, widthtex, heighttex, format, type);
    skinnedMesh.boneTexture0.needsUpdate = true;

    return character;
  }


  static async initGS(gsPath, gsPosition, gsQuaternion, scene, renderer) {
    const gs = new GaussianSplatting(gsPath, 1, gsPosition, gsQuaternion, scene, renderer);
    await gs.loadingPromise;
    scene.add(gs);
    return gs;
  }


  static async load(url, scene, camera, renderer, fileName) {
    console.log('Loading GVRM:', url);
    const response = await fetch(url);
    const zip = await JSZip.loadAsync(response.arrayBuffer());
    const vrmBuffer = await zip.file('model.vrm').async('arraybuffer');
    const plyBuffer = await zip.file('model.ply').async('arraybuffer');
    const extraData = JSON.parse(await zip.file('data.json').async('text'));

    const vrmBlob = new Blob([vrmBuffer], { type: 'application/octet-stream' });
    const vrmUrl = URL.createObjectURL(vrmBlob);

    const plyBlob = new Blob([plyBuffer], { type: 'application/octet-stream' });
    const plyUrl = URL.createObjectURL(plyBlob);

    const modelScale = extraData.modelScale;
    const boneOperations = extraData.boneOperations;

    if (extraData.splatRelativePoses === undefined) {  // TODO: remove
      extraData.splatRelativePoses = extraData.relativePoses;
    }

    const character = await GVRM.initVRM(
      vrmUrl, scene, camera, renderer, modelScale, boneOperations);

    const { sceneSplatIndices, boneSceneMap } = GVRM.sortSplatsByBones(extraData);
    const parser = new PLYParser();
    const sceneUrls = await parser.splitPLY(plyUrl, sceneSplatIndices);

    const gs = await GVRM.initGS(sceneUrls, extraData.gsPosition, extraData.gsQuaternion, scene, renderer);

    const gvrm = new GVRM(character, gs);
    gvrm.modelScale = modelScale;
    gvrm.boneOperations = boneOperations;
    gvrm.boneSceneMap = boneSceneMap;
    gvrm.fileName = fileName;

    const tempNodePos = new THREE.Vector3();
    const tempChildPos = new THREE.Vector3();
    const tempMidPoint = new THREE.Vector3();
    const viewerMatrixWorldInverse = new THREE.Matrix4();
    const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];
    const skeleton = skinnedMesh.skeleton;
    const scenePivots = {};

    gvrm.gs.viewer.updateMatrixWorld(true);
    viewerMatrixWorldInverse.copy(gvrm.gs.viewer.matrixWorld).invert();

    skeleton.bones.forEach((bone) => {
      bone.updateMatrixWorld(true);
      bone.matrixWorld0 = bone.matrixWorld.clone();

      bone.children.forEach((childBone) => {
        const childIndex = skeleton.bones.indexOf(childBone);
        const sceneIndex = boneSceneMap[childIndex];
        if (sceneIndex === undefined) return;

        childBone.updateMatrixWorld(true);
        tempNodePos.setFromMatrixPosition(bone.matrixWorld);
        tempChildPos.setFromMatrixPosition(childBone.matrixWorld);
        tempMidPoint.addVectors(tempNodePos, tempChildPos).multiplyScalar(0.5);
        tempMidPoint.applyMatrix4(viewerMatrixWorldInverse);
        scenePivots[sceneIndex] = tempMidPoint.toArray();
      });
    });

    gvrm.gs.applyScenePivots(scenePivots);

    gvrm.updatePMC();
    GVRMUtils.addPMC(scene, gvrm.pmc);
    GVRMUtils.visualizePMC(gvrm.pmc, false);
    renderer.render(scene, camera);

    gvrm.gs.splatVertexIndices = extraData.splatVertexIndices;
    gvrm.gs.splatBoneIndices = extraData.splatBoneIndices;
    gvrm.gs.splatRelativePoses = extraData.splatRelativePoses;

    // cleanup splats that are too far from the associated bone
    for (let i = 0; i < gvrm.gs.splatCount; i++) {
      let distance = Math.sqrt(
        gvrm.gs.splatRelativePoses[i * 3 + 0] ** 2 +
        gvrm.gs.splatRelativePoses[i * 3 + 1] ** 2 +
        gvrm.gs.splatRelativePoses[i * 3 + 2] ** 2
      );
      if (gvrm.gs.splatBoneIndices[i] !== 57 && distance > 0.2) {  // exclude head
        gvrm.gs.colors[i * 4 + 3] = 0;
      } else if (gvrm.gs.splatBoneIndices[i] == 21 && distance > 0.1) {  // left foot
        gvrm.gs.colors[i * 4 + 3] = 0;
      } else if (gvrm.gs.splatBoneIndices[i] == 19 && distance > 0.1) {  // right foot
        gvrm.gs.colors[i * 4 + 3] = 0;
      } else if (gvrm.gs.splatBoneIndices[i] === 57 && distance > 0.3) {  // head
        gvrm.gs.colors[i * 4 + 3] = 0;
      }
    }

    gvrm.gs.splatMesh.updateDataTexturesFromBaseData(0, gvrm.gs.splatCount - 1);

    gvrm.vrmWorldPosition0 = new THREE.Vector3();
    gvrm.vrmWorldQuaternion0 = new THREE.Quaternion();
    character.currentVrm.scene.getWorldPosition(gvrm.vrmWorldPosition0);
    character.currentVrm.scene.getWorldQuaternion(gvrm.vrmWorldQuaternion0);

    gvrm.isReady = true

    return gvrm;
  }

  static async save(gvrm, vrmPath, gsPath, boneOperations, modelScale, fileName, savePly=false) {
    const vrmBuffer = await fetch(vrmPath).then(response => response.arrayBuffer());
    const plyBuffer = await fetch(gsPath).then(response => response.arrayBuffer());
    const gsScene = gvrm.gs.viewer.splatMesh.scenes[0];
    const gsQuaternion = gvrm.gs.sourceQuaternion ? gvrm.gs.sourceQuaternion.toArray() : gsScene.quaternion.toArray();
    const gsPosition = gvrm.gs.sourcePosition ? gvrm.gs.sourcePosition.toArray() : gsScene.position.toArray();

    const extraData = {
      modelScale: modelScale,
      boneOperations: boneOperations,
      gsQuaternion,
      gsPosition,
      splatVertexIndices: gvrm.gs.splatVertexIndices,
      splatBoneIndices: gvrm.gs.splatBoneIndices,
      splatRelativePoses: gvrm.gs.splatRelativePoses,
    };

    const zip = new JSZip();

    zip.file('model.vrm', vrmBuffer);
    zip.file('model.ply', plyBuffer);
    zip.file('data.json', JSON.stringify(extraData, null, 2));

    const content = await zip.generateAsync({ type: 'blob' });

    if (!fileName && gsPath.endsWith('.ply')) {
      fileName = gsPath.split('/').pop().replace('.ply', '.gvrm');
    } else if (!fileName) {  // blob
      fileName = gsPath.split('/').pop() + '.gvrm';
    }

    _downloadBlob(content, fileName);

    if (savePly) {
      console.log('savePly!');
      const plyBlob = new Blob([plyBuffer], { type: 'application/octet-stream' });
      const plyFileName = fileName.replace('.gvrm', '_processed.ply');
      _downloadBlob(plyBlob, plyFileName);
    }

    function _downloadBlob(blob, fileName) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      if (blob === content && gvrm.url) {  // GVRM
        URL.revokeObjectURL(gvrm.url);
      }
      if (blob === content) {  // GVRM
        gvrm.url = url;
      }
       else {  // PLY
        URL.revokeObjectURL(url);
      }
    }
  }


  static async remove(gvrm, scene) {
    if (gvrm.character) {
      await gvrm.character.leave(scene);
      gvrm.character = null;
    }

    if (gvrm.gs) {
      await gvrm.gs.viewer.dispose();
      gvrm.gs = null;
    }

    if (gvrm.pmc) {
      GVRMUtils.removePMC(scene, gvrm.pmc);
    }
  }

  async load(url, scene, camera, renderer, fileName=null) {
    const _gvrm = await GVRM.load(url, scene, camera, renderer, fileName);

    // TODO: refactor
    this.character = _gvrm.character;
    // this.character.animationUrl = animationUrl;
    // this.character.currentMixer = currentMixer;
    this.gs = _gvrm.gs;
    this.modelScale = _gvrm.modelScale;
    this.boneOperations = _gvrm.boneOperations;
    this.boneSceneMap = _gvrm.boneSceneMap;
    this.vertexSceneMap = _gvrm.vertexSceneMap;
    this.fileName = _gvrm.fileName;
    this.vrmWorldPosition0 = _gvrm.vrmWorldPosition0;
    this.vrmWorldQuaternion0 = _gvrm.vrmWorldQuaternion0;
    this.isReady = true;
  }

  async save(vrmPath, gsPath, boneOperations, modelScale, fileName, savePly=false) {
    await GVRM.save(this, vrmPath, gsPath, boneOperations, modelScale, fileName, savePly);
  }

  async remove(scene) {
    this.isReady = false;
    await GVRM.remove(this, scene);
  }

  async changeFBX(url) {
    // GVRMUtils.resetPose(this.character, this.boneOperations);
    await this.character.changeFBX(url);
  }

  updatePMC() {
    const { pmc } = GVRMUtils.getPointsMeshCapsules(this.character);
    this.pmc = pmc;
  }

  updateByBones() {
    if (this.gs.skinning) {
      this.gs.updateSkinningFromCharacter(this.character);
      return;
    }

    const tempNodePos = new THREE.Vector3();
    const tempChildPos = new THREE.Vector3();
    const tempMidPoint = new THREE.Vector3();
    const tempMat = new THREE.Matrix4();
    const tempQuat = new THREE.Quaternion();
    const tempSwingQuat = new THREE.Quaternion();
    const gsViewerMatrixWorldInverse = new THREE.Matrix4();
    const gsViewerWorldQuat = new THREE.Quaternion();
    const gsViewerWorldQuatInverse = new THREE.Quaternion();
    const tempRestParentPos = new THREE.Vector3();
    const tempRestChildPos = new THREE.Vector3();
    const tempRestDir = new THREE.Vector3();
    const tempCurrentDir = new THREE.Vector3();
    const swingOnlyBoneList = new Set([
      "J_Bip_L_LowerArm",
      "J_Bip_R_LowerArm",
      "J_Bip_L_LowerLeg",
      "J_Bip_R_LowerLeg",
    ]);
    let updatedSceneTransforms = false;

    if (!this.boneSceneMap) return;

    const skinnedMesh = this.character.currentVrm.scene.children[this.character.skinnedMeshIndex];
    const skeleton = skinnedMesh.skeleton;

    this.gs.viewer.updateMatrixWorld();
    gsViewerMatrixWorldInverse.copy(this.gs.viewer.matrixWorld).invert();
    this.gs.viewer.getWorldQuaternion(gsViewerWorldQuat);
    gsViewerWorldQuatInverse.copy(gsViewerWorldQuat).invert();

    skeleton.bones.forEach((bone) => {
      const children = bone.children;
      if (children.length === 0) return;

      children.forEach(childBone => {
        const childIndex = skeleton.bones.indexOf(childBone);
        const sceneIndex = this.boneSceneMap[childIndex];
        if (sceneIndex === undefined || !childBone.matrixWorld0) return;

        bone.updateMatrixWorld(true);
        childBone.updateMatrixWorld(true);
        tempNodePos.setFromMatrixPosition(bone.matrixWorld);
        tempChildPos.setFromMatrixPosition(childBone.matrixWorld);
        tempMidPoint.addVectors(tempNodePos, tempChildPos).multiplyScalar(0.5);

        tempMidPoint.applyMatrix4(gsViewerMatrixWorldInverse);

        tempMat.copy(childBone.matrixWorld).multiply(childBone.matrixWorld0.clone().invert());
        tempQuat.setFromRotationMatrix(tempMat);
        tempQuat.premultiply(gsViewerWorldQuatInverse);
        tempQuat.multiply(this.gs.quaternion0);

        const scene = this.gs.viewer.getSplatScene(sceneIndex);
        if (scene) {
          scene.position.copy(tempMidPoint);
          if (
            swingOnlyBoneList.has(childBone.name) &&
            bone.matrixWorld0 &&
            childBone.matrixWorld0
          ) {
            tempRestParentPos.setFromMatrixPosition(bone.matrixWorld0);
            tempRestChildPos.setFromMatrixPosition(childBone.matrixWorld0);
            tempRestDir.copy(tempRestChildPos).sub(tempRestParentPos);
            tempCurrentDir.copy(tempChildPos).sub(tempNodePos);

            if (tempRestDir.lengthSq() > 1e-8 && tempCurrentDir.lengthSq() > 1e-8) {
              tempSwingQuat.setFromUnitVectors(
                tempRestDir.normalize(),
                tempCurrentDir.normalize(),
              );
              tempSwingQuat.premultiply(gsViewerWorldQuatInverse);
              tempSwingQuat.multiply(this.gs.quaternion0);
              scene.quaternion.copy(tempSwingQuat);
            } else {
              scene.quaternion.copy(tempQuat);
            }
          } else {
            scene.quaternion.copy(tempQuat);
          }
          updatedSceneTransforms = true;
          let axesHelper = this.debugAxes.get(sceneIndex);
          if (!axesHelper) {
            axesHelper = this.createDebugAxes(sceneIndex);
          }
          axesHelper.position.copy(tempMidPoint);
          axesHelper.quaternion.copy(tempQuat);
        }
      });
    });

    if (updatedSceneTransforms) {
      this.gs.viewer.updateMatrixWorld(true);
      this.gs.sparkRenderer.needsUpdate = true;
    }
  }

  // deprecated
  // updateByVertices() {}

  createDebugAxes(sceneIndex) {
    const axesHelper = new THREE.AxesHelper(0.3);
    axesHelper.visible = false;
    this.gs.add(axesHelper);
    this.debugAxes.set(sceneIndex, axesHelper);
    return axesHelper;
  }

  update() {
    if (!this.isReady) return;
    let tempQuat = this.character.currentVrm.scene.quaternion.clone();
    let tempQuat0 = this.character.currentVrm.scene.quaternion0.clone();
    let tempPos = this.character.currentVrm.scene.position.clone();
    let tempPos0 = this.character.currentVrm.scene.position0.clone();
    this.gs.viewer.quaternion.copy(tempQuat.multiply(tempQuat0.invert()));
    this.gs.viewer.position.copy(tempPos.sub(tempPos0));

    if (this.gs.skinning) {
      this.character.update();
      this.updateByBones();
      return;
    }

    this.updateByBones();
    this.character.update();
  }

  static sortSplatsByBones(extraData) {
    const sceneSplatIndices = {};

    let sceneCount = 0;
    const boneSceneMap = {};

    for (let i = 0; i < extraData.splatBoneIndices.length; i++) {
      const boneIndex = extraData.splatBoneIndices[i];

      if (boneSceneMap[boneIndex] === undefined) {
        boneSceneMap[boneIndex] = sceneCount;
        sceneCount++;
        sceneSplatIndices[boneSceneMap[boneIndex]] = [];
      }
      sceneSplatIndices[boneSceneMap[boneIndex]].push(i);
    }

    GVRM.updateExtraData(extraData, sceneSplatIndices);

    return { sceneSplatIndices, boneSceneMap };
  }


  // deprecated
  // static sortSplatsByVertices(extraData) {}


  static updateExtraData(extraData, sceneSplatIndices) {

    let splatIndices = [];
    for (let i = 0; i < Object.keys(sceneSplatIndices).length; i++) {
      splatIndices = splatIndices.concat(sceneSplatIndices[i]);
    }

    const splatVertexIndices = [];
    const splatBoneIndices = [];
    const splatRelativePoses = [];

    for (const sceneIndex of Object.keys(sceneSplatIndices)) {
      for (const splatIndex of sceneSplatIndices[sceneIndex]) {
        splatVertexIndices.push(extraData.splatVertexIndices[splatIndex]);
        splatBoneIndices.push(extraData.splatBoneIndices[splatIndex]);
        splatRelativePoses.push(
          extraData.splatRelativePoses[splatIndex * 3],
          extraData.splatRelativePoses[splatIndex * 3 + 1],
          extraData.splatRelativePoses[splatIndex * 3 + 2]
        );
      }
    }

    extraData.splatVertexIndices = splatVertexIndices;
    extraData.splatBoneIndices = splatBoneIndices;
    extraData.splatRelativePoses = splatRelativePoses;
  }


  static async gsCustomizeMaterial(character, gs) {
    await gs.applyCharacterSkinning(character, gs.splatVertexIndices, gs.splatRelativePoses);
  }
}


export * as GVRMUtils from './utils.js';
