// electron-builder afterPack hook: ad-hoc sign the macOS app when no real signing identity is configured.
// Without a *valid* signature, Apple Silicon Macs report a downloaded unsigned app as "damaged and can't be opened".
// An ad-hoc signature turns that into the normal "unidentified developer" prompt (right-click > Open).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return; // real signing is configured; electron-builder handles it
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${app}`);
};
