import * as THREE from 'three';
import type { SparkRenderer } from '@sparkjsdev/spark';

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

export interface BoneOperation {
  boneName: string;
  position?: Partial<XYZ>;
  rotation?: Partial<XYZ>;
  scale?: Partial<XYZ>;
}

export interface GVRMInitOptions {
  sparkRenderer?: SparkRenderer;
  sparkSkinning?: boolean;
}

export interface GVRMLoadOptions extends GVRMInitOptions {
  fileName?: string | null;
}

export interface PMC {
  points: THREE.Points;
  mesh: THREE.Mesh;
  capsules: THREE.Group;
}

export interface GaussianSplatMeshCompat {
  scenes: THREE.Object3D[];
  pointCloudModeEnabled: boolean;
  renderOrder: number;
  updateDataTexturesFromBaseData(startIndex?: number, endIndex?: number): void;
  setPointCloudModeEnabled(enabled: boolean): void;
}

export interface GaussianSplattingLike extends THREE.Group {
  sparkRenderer: SparkRenderer;
  viewer: THREE.Group & {
    sparkRenderer: SparkRenderer;
    getSplatScene(index: number): THREE.Object3D | undefined;
  };
  splatMesh: GaussianSplatMeshCompat;
  skinning?: unknown;
  splatCount: number;
  splatVertexIndices?: number[];
  splatBoneIndices?: number[];
  splatRelativePoses?: number[];
  sourcePosition: THREE.Vector3;
  sourceQuaternion: THREE.Quaternion;
  sourceScale: number;
  position0: THREE.Vector3;
  quaternion0: THREE.Quaternion;
  rotation0: THREE.Euler;
  matrix0: THREE.Matrix4;
}

export class GVRM extends THREE.Group {
  character: unknown;
  gs: GaussianSplattingLike;
  debugAxes: Map<number, THREE.AxesHelper>;
  sceneFrameData?: Record<number, {
    localSideAxis: number[];
    restFrameQuaternion: number[];
  }>;
  modelScale?: number;
  boneOperations?: BoneOperation[] | null;
  boneSceneMap?: Record<number, number>;
  vertexSceneMap?: Record<number, number>;
  fileName?: string | null;
  vrmWorldPosition0?: THREE.Vector3;
  vrmWorldQuaternion0?: THREE.Quaternion;
  pmc?: PMC;
  isReady: boolean;
  t: number;
  sparkSkinning?: boolean;

  constructor(character: unknown, gs: GaussianSplattingLike);

  static initVRM(
    vrmPath: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    modelScale?: number,
    boneOperations?: BoneOperation[] | null,
  ): Promise<unknown>;

  static initGS(
    gsPath: string | string[],
    gsPosition: number[] | undefined,
    gsQuaternion: number[] | undefined,
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    options?: GVRMInitOptions,
  ): Promise<GaussianSplattingLike>;

  static load(
    url: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    options?: GVRMLoadOptions,
  ): Promise<GVRM>;

  static load(
    url: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    fileName: string | null,
    options?: GVRMInitOptions,
  ): Promise<GVRM>;

  static save(
    gvrm: GVRM,
    vrmPath: string,
    gsPath: string,
    boneOperations: BoneOperation[] | null | undefined,
    modelScale: number | undefined,
    fileName?: string | null,
    savePly?: boolean,
  ): Promise<void>;

  static remove(gvrm: GVRM, scene: THREE.Scene): Promise<void>;

  load(
    url: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    options?: GVRMLoadOptions,
  ): Promise<void>;

  load(
    url: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    fileName: string | null,
    options?: GVRMInitOptions,
  ): Promise<void>;

  save(
    vrmPath: string,
    gsPath: string,
    boneOperations: BoneOperation[] | null | undefined,
    modelScale: number | undefined,
    fileName?: string | null,
    savePly?: boolean,
  ): Promise<void>;

  remove(scene: THREE.Scene): Promise<void>;
  changeFBX(url: string): Promise<void>;
  updatePMC(): void;
  updateByBones(): void;
  createDebugAxes(sceneIndex: number): THREE.AxesHelper;
  update(): void;

  static sortSplatsByBones(extraData: {
    splatBoneIndices: number[];
    splatVertexIndices: number[];
    splatRelativePoses: number[];
  }): {
    sceneSplatIndices: Record<number, number[]>;
    boneSceneMap: Record<number, number>;
  };

  static updateExtraData(
    extraData: {
      splatVertexIndices: number[];
      splatBoneIndices: number[];
      splatRelativePoses: number[];
    },
    sceneSplatIndices: Record<number, number[]>,
  ): void;

  static gsCustomizeMaterial(character: unknown, gs: GaussianSplattingLike): Promise<void>;
}

export namespace GVRMUtils {
  const colors: number[][];
  const BONE_CONFIG: Record<string, {
    names: string[];
    radius: number;
    scale: {
      x: number;
      z: number;
    };
  }>;

  function applyBoneOperations(vrm: unknown, boneOperations: BoneOperation[]): void;
  function setPose(character: unknown, boneOperations: BoneOperation[]): void;
  function resetPose(character: unknown, boneOperations: BoneOperation[]): void;
  function visualizeVRM(character: unknown, flag: boolean | null): void;
  function visualizePMC(pmc: PMC, flag: boolean | null): void;
  function visualizeBoneAxes(gvrm: GVRM, flag: boolean | null): void;
  function removePMC(scene: THREE.Scene, pmc: PMC): void;
  function addPMC(scene: THREE.Scene, pmc: PMC): void;
  function addChannels(
    fromArray: ArrayLike<number>,
    toArray: {
      [index: number]: number;
    },
    count: number,
    N?: number,
  ): void;
  function createDataTexture(...args: ConstructorParameters<typeof THREE.DataTexture>): THREE.DataTexture;
  function simpleAnim(character: unknown, t: number): void;
  function getPointsMeshCapsules(character: unknown): {
    pmc: PMC;
    capsuleBoneIndex: number[];
  };
}
