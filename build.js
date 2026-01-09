import * as esbuild from 'esbuild';

// CDN用: gaussian-splats-3d を外部依存のまま
await esbuild.build({
  entryPoints: ['gvrm-format/gvrm.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  outfile: 'lib/gaussian-vrm.min.js',
  external: ['three', 'three/*', '@pixiv/three-vrm', 'jszip', 'gaussian-splats-3d'],
});
console.log('Build complete: lib/gaussian-vrm.min.js (CDN)');

// npm用: gaussian-splats-3d を含める
await esbuild.build({
  entryPoints: ['gvrm-format/gvrm.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  outfile: 'lib/gaussian-vrm.bundled.js',
  external: ['three', 'three/*', '@pixiv/three-vrm', 'jszip'],
  alias: {
    'gaussian-splats-3d': './lib/gaussian-splats-3d.module.js',
  },
  banner: {
    js: '// @naruya/gaussian-vrm - https://github.com/naruya/gaussian-vrm\n// Includes gaussian-splats-3d (MIT License)',
  },
});
console.log('Build complete: lib/gaussian-vrm.bundled.js (npm)');
