/**
 * .pnpmfile.cjs - pnpm hook for overriding sub-dependency manifests.
 *
 * Ensures uuid is deduplicated to ^14.0.0 across all transitive
 * Google Cloud libraries that still pin older major versions.
 */

function readPackage(pkg, context) {
  // cloudevents@10.0.0 depends on uuid@^8.3.2 → bump to ^14.0.0
  if (pkg.name === 'cloudevents') {
    if (pkg.dependencies && pkg.dependencies['uuid']) {
      pkg.dependencies['uuid'] = '^14.0.0';
      context.log('[pnpmfile] cloudevents: uuid → ^14.0.0');
    }
  }

  // gaxios@6.x depends on uuid@^9.0.0 → bump to ^14.0.0
  if (pkg.name === 'gaxios') {
    if (pkg.dependencies && pkg.dependencies['uuid']) {
      pkg.dependencies['uuid'] = '^14.0.0';
      context.log('[pnpmfile] gaxios: uuid → ^14.0.0');
    }
  }

  // teeny-request@9.x depends on uuid@^9.0.0 → bump to ^14.0.0
  if (pkg.name === 'teeny-request') {
    if (pkg.dependencies && pkg.dependencies['uuid']) {
      pkg.dependencies['uuid'] = '^14.0.0';
      context.log('[pnpmfile] teeny-request: uuid → ^14.0.0');
    }
  }

  // google-gax@4.x depends on uuid@^9.0.0 → bump to ^14.0.0
  if (pkg.name === 'google-gax') {
    if (pkg.dependencies && pkg.dependencies['uuid']) {
      pkg.dependencies['uuid'] = '^14.0.0';
      context.log('[pnpmfile] google-gax: uuid → ^14.0.0');
    }
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
