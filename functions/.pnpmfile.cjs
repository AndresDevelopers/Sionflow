/**
 * .pnpmfile.cjs - pnpm hook for Cloud Functions dependencies.
 *
 * uuid must stay on a dual CJS/ESM release (11.x). uuid@12+ is pure ESM and
 * breaks gaxios@6 / google-gax via require('uuid') → ERR_REQUIRE_ESM.
 * 11.1.1+ also patches GHSA-w5hq-g745-h8pq (buffer bounds in v3/v5/v6).
 */

const UUID_CJS_SAFE = '11.1.1';

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
