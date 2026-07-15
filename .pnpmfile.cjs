/**
 * .pnpmfile.cjs - pnpm hook for overriding sub-dependency manifests.
 *
 * pnpm's top-level "overrides" field cannot force semver-incompatible upgrades
 * or change exact-version pins. This hook modifies package manifests before
 * resolution so that vulnerable sub-dependencies are upgraded in-place.
 */

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

  // ── uuid (buffer bounds check in v3/v5/v6) ──────────────────────
  // cloudevents@10.0.0 depends on uuid@^8.3.2. Bump to ^14.0.0 to
  // deduplicate with the workspace root (which already uses uuid@14).
  if (pkg.name === 'cloudevents') {
    if (pkg.dependencies && pkg.dependencies['uuid']) {
      pkg.dependencies['uuid'] = '^14.0.0';
      context.log('[pnpmfile] cloudevents: uuid → ^14.0.0');
    }
  }

  // gaxios@6.x depends on uuid@^9.0.0.  Bump to ^14.0.0 so the
  // override in the root package.json can collapse all uuid copies.
  if (pkg.name === 'gaxios') {
    if (pkg.dependencies && pkg.dependencies['uuid']) {
      pkg.dependencies['uuid'] = '^14.0.0';
      context.log('[pnpmfile] gaxios: uuid → ^14.0.0');
    }
  }

  // teeny-request@9.x depends on uuid@^9.0.0.  Bump to ^14.0.0.
  if (pkg.name === 'teeny-request') {
    if (pkg.dependencies && pkg.dependencies['uuid']) {
      pkg.dependencies['uuid'] = '^14.0.0';
      context.log('[pnpmfile] teeny-request: uuid → ^14.0.0');
    }
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
  // Next.js 16.2.10 bundles postcss 8.4.31 internally.  pnpm cannot
  // override bundled dependencies, so this is documented as a known
  // accepted risk (build-time only, no user-controlled CSS rendered).
  // The workspace devDependency is already at postcss@^8.5.19.

  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
