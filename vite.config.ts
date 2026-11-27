import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {computeStableSourceFingerprint} from './src/server/sourceFingerprint';

export default defineConfig(({command}) => {
  const pkgPath = path.resolve('.', 'package.json');
  let pkgVersion = '2.3.2.5';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.version && pkg.version !== '0.0.0') {
      pkgVersion = String(pkg.version);
    }
  } catch {
    // Use fallback version
  }

  const isBuild = command === 'build';
  const sourceFingerprint = computeStableSourceFingerprint(path.resolve('.'));

  const buildTimestamp =
    process.env.VITE_BUILD_TIMESTAMP ||
    process.env.SIGNALYN_BUILD_TIMESTAMP ||
    process.env.BUILD_TIMESTAMP ||
    (isBuild ? new Date().toISOString() : 'UNKNOWN');

  const commitSha =
    process.env.VITE_GIT_COMMIT_SHA ||
    process.env.SIGNALYN_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    process.env.SHORT_SHA ||
    sourceFingerprint ||
    'UNKNOWN';

  const compactTs =
    buildTimestamp !== 'UNKNOWN'
      ? buildTimestamp.replace(/[^0-9]/g, '').slice(0, 14)
      : '';

  const buildId =
    process.env.VITE_BUILD_ID ||
    process.env.SIGNALYN_BUILD_ID ||
    process.env.BUILD_ID ||
    process.env.CLOUD_BUILD_ID ||
    (isBuild && compactTs
      ? `signalyn-v${pkgVersion}-${compactTs}`
      : sourceFingerprint !== 'UNKNOWN'
      ? `signalyn-v${pkgVersion}-${sourceFingerprint}`
      : 'UNKNOWN');

  const serverReleaseId =
    process.env.SIGNALYN_SERVER_RELEASE_ID ||
    process.env.SERVER_RELEASE_ID ||
    (process.env.K_SERVICE === 'signalyn' ? process.env.K_REVISION : undefined) ||
    buildId ||
    'UNKNOWN';

  const environment =
    process.env.VITE_DEPLOYMENT_ENV ||
    process.env.DEPLOYMENT_ENV ||
    (process.env.K_SERVICE === 'signalyn'
      ? 'cloud-run-production'
      : isBuild || process.env.NODE_ENV === 'production'
      ? 'production'
      : 'ai-studio-preview');

  const releaseMeta = {
    appVersion: pkgVersion,
    buildId,
    commitSha,
    buildTimestamp,
    environment,
    serverReleaseId,
  };

  return {
    define: {
      __SIGNALYN_RELEASE_META__: JSON.stringify(releaseMeta),
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'signalyn-release-metadata',
        closeBundle() {
          if (!isBuild) return;
          try {
            const distDir = path.resolve('.', 'dist');
            if (fs.existsSync(distDir)) {
              fs.writeFileSync(
                path.join(distDir, 'release-metadata.json'),
                JSON.stringify(releaseMeta, null, 2),
                'utf-8'
              );
            }
          } catch {
            // Non-fatal if dist write skipped
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
