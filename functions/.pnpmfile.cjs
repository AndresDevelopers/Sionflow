/**
 * .pnpmfile.cjs - pnpm hook for Cloud Functions dependencies.
 *
 * uuid must stay on 9.x (dual CJS/ESM). uuid@10+ is pure ESM and breaks
 * gaxios@6 / google-gax via require('uuid') → ERR_REQUIRE_ESM.
 */

const UUID_CJS_SAFE = '9.0.1';

function pinUuid(pkg, context) {
  if (pkg.dependencies && pkg.dependencies['uuid']) {
    const prev = pkg.dependencies['uuid'];
    pkg.dependencies['uuid'] = UUID_CJS_SAFE;
    if (prev !== UUID_CJS_SAFE) {
      context.log(`[pnpmfile] ${pkg.name}: uuid ${prev} → ${UUID_CJS_SAFE}`);
    }
  }
}

function readPackage(pkg, context) {
  if (
    pkg.name === 'cloudevents' ||
    pkg.name === 'gaxios' ||
    pkg.name === 'teeny-request' ||
    pkg.name === 'google-gax'
  ) {
    pinUuid(pkg, context);
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
