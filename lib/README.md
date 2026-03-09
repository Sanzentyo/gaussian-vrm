# lib/

## gaussian-splats-3d.module.js

This file is a legacy local copy based on [@mkkellogg/gaussian-splats-3d@0.4.7](https://www.npmjs.com/package/@mkkellogg/gaussian-splats-3d) with custom modifications for the pre-Spark GVRM pipeline. The current app and library builds now use `@sparkjsdev/spark` instead of this file.

### 1. Download

```bash
wget https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js
```

### 2. Modify

#### Line 383-384: Add originalIndex tracking
```diff
     addSplat(splat) {
+        splat.originalIndex = this.splatCount;
         this.splats.push(splat);
         this.splatCount++;
     }
```

#### Lines 3377-3383: Disable depth sorting
```diff
             splatArray.splats.forEach((splat) => {
                 center.set(splat[UncompressedSplatArray.OFFSET.X], splat[UncompressedSplatArray.OFFSET.Y], splat[UncompressedSplatArray.OFFSET.Z]);
                 clampPoint(center);
                 splat.centerDist = center.lengthSq();
             });
-            splatArray.splats.sort((a, b) => {
-                let centerADist = a.centerDist;
-                let centerBDist = b.centerDist;
-                if (centerADist > centerBDist) return 1;
-                else return -1;
-            });
+            // splatArray.splats.sort((a, b) => {
+            //     let centerADist = a.centerDist;
+            //     let centerBDist = b.centerDist;
+            //     if (centerADist > centerBDist) return 1;
+            //     else return -1;
+            // });

             const sectionFilters = [];
```

#### Line 4720-4724: Default to PLY format
```diff
 const sceneFormatFromPath = (path) => {
     if (path.endsWith('.ply')) return SceneFormat.Ply;
     else if (path.endsWith('.splat')) return SceneFormat.Splat;
     else if (path.endsWith('.ksplat')) return SceneFormat.KSplat;
     else if (path.endsWith('.spz')) return SceneFormat.Spz;
-    return null;
+    return SceneFormat.Ply;
 };
```
