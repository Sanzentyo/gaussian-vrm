import * as esbuild from 'esbuild';

// CDN用: Spark を外部依存のまま
await esbuild.build({
  entryPoints: ['gvrm-format/gvrm.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  outfile: 'lib/gaussian-vrm.min.js',
  external: ['three', 'three/*', '@pixiv/three-vrm', 'jszip', '@sparkjsdev/spark'],
});
console.log('Build complete: lib/gaussian-vrm.min.js (CDN)');

// npm用: Spark を peer dependency として扱う
await esbuild.build({
  entryPoints: ['gvrm-format/gvrm.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  outfile: 'lib/gaussian-vrm.bundled.js',
  external: ['three', 'three/*', '@pixiv/three-vrm', 'jszip', '@sparkjsdev/spark'],
  banner: {
    js: '// @naruya/gaussian-vrm - https://github.com/naruya/gaussian-vrm\n// Requires @sparkjsdev/spark (MIT License)',
  },
});
console.log('Build complete: lib/gaussian-vrm.bundled.js (npm)');
