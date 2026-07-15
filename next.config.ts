
import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
  sw: 'sw.js',
  // Manual registration (ServiceWorkerRegistration) so we control claim/warmup
  register: false,
  customWorkerSrc: 'worker',
  // Critical for App Router offline: cache each client navigation + its JS/CSS
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  cacheStartUrl: true,
  dynamicStartUrl: true,
  // Don't force full reload when back online (keeps in-memory offline state)
  reloadOnOnline: false,
  // Fallback HTML if a route was never cached
  fallbacks: {
    document: '/~offline',
  },
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        // Override default "pages" — short network timeout so mobile offline fails over fast
        urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages',
          networkTimeoutSeconds: 2,
          expiration: {
            maxEntries: 128,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        // Next.js App Router flight/RSC payloads for client-side route changes
        urlPattern: ({ url, request }: { url: URL; request: Request }) =>
          request.method === 'GET' &&
          (url.searchParams.has('_rsc') ||
            request.headers.get('RSC') === '1' ||
            request.headers.get('Next-Router-Prefetch') === '1'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-rsc',
          networkTimeoutSeconds: 2,
          expiration: {
            maxEntries: 128,
            maxAgeSeconds: 60 * 60 * 24 * 7,
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        // Same-origin API reads (members list, icons, etc.)
        urlPattern: ({ url }: { url: URL }) =>
          url.pathname.startsWith('/api/') && !url.pathname.includes('auth'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'apis',
          networkTimeoutSeconds: 5,
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 60 * 60 * 24 * 7,
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        // Firebase Storage / GCS images — keep for offline avatars & gallery
        urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'firebase-storage-images',
          expiration: {
            maxEntries: 300,
            maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        urlPattern: /^https:\/\/storage\.googleapis\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'gcs-images',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24 * 60,
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        urlPattern: /^https:\/\/.*\.firebasestorage\.app\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'firebase-app-images',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24 * 60,
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        // Remote icons / placehold (if any)
        urlPattern: /^https:\/\/(placehold\.co|picsum\.photos)\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'remote-placeholder-images',
          expiration: {
            maxEntries: 32,
            maxAgeSeconds: 60 * 60 * 24 * 7,
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    // Fail the production build on type errors (security-sensitive auth/scope code).
    ignoreBuildErrors: false,
  },
  // Fix source map issues in development
  productionBrowserSourceMaps: false,

  // Legacy Spanish route → multi-language council page
  // Admin general: /admin/login|panel chocaba con (main)/admin → redirige a /app-admin/*
  async redirects() {
    return [
      {
        source: "/consejo",
        destination: "/council",
        permanent: true,
      },
      {
        source: "/admin/login",
        destination: "/app-admin/login",
        permanent: false,
      },
      {
        source: "/admin/panel",
        destination: "/app-admin/panel",
        permanent: false,
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
              // Firebase Messaging SW (firebase-messaging-sw.js) importScripts from gstatic.
              // Without this, push fails on modern Chrome/Android (incl. Android 16) when the SW installs/updates.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://*.gstatic.com https://*.firebaseio.com https://*.firebase.com",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Images: https + data/blob only (no cleartext http — mixed content / tracking)
              "img-src 'self' data: blob: https:",
              "font-src 'self' https://fonts.gstatic.com",
              // FCM token registration + Installations + Firestore/Storage
              "connect-src 'self' https://*.firebaseio.com https://*.firebase.com https://*.googleapis.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://fcm.googleapis.com https://www.gstatic.com https://storage.googleapis.com https://*.firebasestorage.app wss://*.firebaseio.com https://api.deepseek.com https://*.upstash.io https://generativelanguage.googleapis.com https://nominatim.openstreetmap.org",
              "frame-src 'self' https://*.firebaseapp.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      {
        source: '/favicon.ico',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
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
