
import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
  sw: 'sw.js',
  // Manual registration in ServiceWorkerRegistration (login + main layout)
  register: false,
  customWorkerSrc: 'worker',
  // App shell offline: serve last good navigation when the network is down
  fallbacks: {
    document: '/',
  },
  // Keep default Workbox rules (fonts, etc.) and append ours
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    runtimeCaching: [
      {
        // HTML / client navigations — network first, then cache (offline shell)
        urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-cache',
          networkTimeoutSeconds: 3,
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 60 * 60 * 24 * 7,
          },
        },
      },
      {
        // Members list API — last good response usable offline
        urlPattern: /\/api\/members/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-members',
          networkTimeoutSeconds: 5,
          expiration: {
            maxEntries: 16,
            maxAgeSeconds: 60 * 60 * 24 * 7,
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  // Fix source map issues in development
  productionBrowserSourceMaps: false,

  // Legacy Spanish route → multi-language council page
  async redirects() {
    return [
      {
        source: "/consejo",
        destination: "/council",
        permanent: true,
      },
    ];
  },

  // ── Security & SEO Headers ─────────────────────────────────────────
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Permissions-Policy", value: "camera=(), microphone=self, geolocation=self, interest-cohort=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.firebaseio.com https://*.firebase.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://*.firebaseio.com https://*.firebase.com https://*.googleapis.com https://storage.googleapis.com https://*.firebasestorage.app wss://*.firebaseio.com https://api.deepseek.com https://*.upstash.io https://generativelanguage.googleapis.com https://nominatim.openstreetmap.org",
              "frame-src 'self' https://*.firebaseapp.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      // En producción: cache larga de assets con hash.
      // En desarrollo: NUNCA cachear /_next/static — si no, el navegador se queda
      // con bundles viejos (p. ej. Server Actions obsoletas) y muestra
      // UnrecognizedActionError aunque el código en disco ya esté actualizado.
      ...(process.env.NODE_ENV === 'production'
        ? [
            {
              source: '/_next/static/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'public, max-age=31536000, immutable',
                },
              ],
            },
            {
              source: '/favicon.ico',
              headers: [
                { key: 'Cache-Control', value: 'public, max-age=86400' },
              ],
            },
          ]
        : [
            {
              source: '/_next/static/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'no-store, no-cache, must-revalidate, max-age=0',
                },
              ],
            },
            {
              source: '/:path*',
              headers: [
                {
                  key: 'Cache-Control',
                  value: 'no-store, no-cache, must-revalidate, max-age=0',
                },
              ],
            },
          ]),
    ];
  },
  // Webpack configuration for source maps
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Disable source maps in development to avoid conflicts
      config.devtool = false;
    }
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        message: /Critical dependency: the request of a dependency is an expression/,
        module: /[\\/]node_modules[\\/]\.pnpm[\\/]express@.*[\\/]node_modules[\\/]express[\\/]lib[\\/]view\.js/,
      },
      {
        message: /Critical dependency: the request of a dependency is an expression/,
        module: /[\\/]node_modules[\\/].*?[\\/]@opentelemetry[\\/]instrumentation[\\/]build[\\/]esm[\\/]platform[\\/]node[\\/]instrumentation\.js/,
      },
      {
        message: /Critical dependency: require function is used in a way in which dependencies cannot be statically extracted/,
        module: /[\\/]node_modules[\\/].*?[\\/]require-in-the-middle[\\/]index\.js/,
      },
    ];
    return config;
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.firebasestorage.app',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withPWA(nextConfig);
