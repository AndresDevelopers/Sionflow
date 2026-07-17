/**
 * .pnpmfile.cjs - pnpm hook for overriding sub-dependency manifests.
 *
 * pnpm's top-level "overrides" field cannot force semver-incompatible upgrades
 * or change exact-version pins. This hook modifies package manifests before
 * resolution so that vulnerable sub-dependencies are upgraded in-place.
 *
 * uuid: MUST stay on a dual CJS/ESM release. uuid@12+ is pure ESM and breaks
 * gaxios@6 / teeny-request via `require('uuid')` → ERR_REQUIRE_ESM.
 * That failure used to surface as "Invalid ID token" on API auth because
 * firebase-admin Storage loads gaxios when the Cloud Storage client is imported.
 *
 * Use 11.1.1+ (not 9.x): GHSA-w5hq-g745-h8pq / CVE-2026-41907 fixed buffer
 * bounds checks in v3/v5/v6 when `buf` is provided. uuid@11 remains dual-package
 * (require → dist/cjs); prefer it over 9.x which is EOL and unpatched.
 */

/** Dual-package (CJS+ESM) uuid that gaxios@6 can require(), with GHSA fix. */
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
  // ── serialize-javascript (RCE + DoS) ────────────────────────────
  // @rollup/plugin-terser@0.4.4 pins serialize-javascript@^6.0.1
  // which stays on 6.0.2. Force it to ^7.0.7 (the 7.x line is safe).
  if (pkg.name === '@rollup/plugin-terser') {
    if (pkg.dependencies && pkg.dependencies['serialize-javascript']) {
      pkg.dependencies['serialize-javascript'] = '^7.0.7';
      context.log(
        `[pnpmfile] @rollup/plugin-terser: serialize-javascript → ^7.0.7`
      );
    }
  }

  // ── uuid (CJS-safe + GHSA-w5hq-g745-h8pq) ───────────────────────
  // cloudevents / gaxios@6 / teeny-request / google-gax still `require('uuid')`.
  // Do NOT pin uuid@12+ (ESM-only) — production broke with ERR_REQUIRE_ESM.
  if (
    pkg.name === 'cloudevents' ||
    pkg.name === 'gaxios' ||
    pkg.name === 'teeny-request' ||
    pkg.name === 'google-gax'
  ) {
    pinUuid(pkg, context);
  }

  // ── workbox-build / workbox-webpack-plugin ───────────────────────
  // @ducanh2912/next-pwa pins exact versions (7.1.1 / 7.1.0).  Bump
  // to ^7.4.1 so we pick up @rollup/plugin-terser@^1.0.0, which
  // already depends on the safe serialize-javascript@^7.0.3.
  if (pkg.name === '@ducanh2912/next-pwa') {
    if (pkg.dependencies) {
      if (pkg.dependencies['workbox-build']) {
        pkg.dependencies['workbox-build'] = '^7.4.1';
        context.log(
          '[pnpmfile] @ducanh2912/next-pwa: workbox-build → ^7.4.1'
        );
      }
      if (pkg.dependencies['workbox-webpack-plugin']) {
        pkg.dependencies['workbox-webpack-plugin'] = '^7.4.1';
        context.log(
          '[pnpmfile] @ducanh2912/next-pwa: workbox-webpack-plugin → ^7.4.1'
        );
      }
    }
  }

  // ── postcss (XSS via unescaped </style>) ────────────────────────
  // Next.js 16.2.10 bundles postcss 8.4.31 internally. Force it to
  // 8.5.19+ which fixes CVE-2026-41305 (unescaped </style> in CSS
  // stringify output enabling XSS).
  if (pkg.name === 'next') {
    if (pkg.dependencies && pkg.dependencies['postcss']) {
      pkg.dependencies['postcss'] = '^8.5.19';
      context.log(
        '[pnpmfile] next: postcss → ^8.5.19'
      );
    }
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
