
import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
  sw: 'sw.js',
  register: false,
  customWorkerSrc: 'worker',
});

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  // Fix source map issues in development
  productionBrowserSourceMaps: false,

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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.firebaseio.com https://*.firebase.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://*.firebaseio.com https://*.firebase.com https://*.googleapis.com wss://*.firebaseio.com https://api.deepseek.com https://*.upstash.io",
              "frame-src 'self' https://*.firebaseapp.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      {
        // Cache estática agresiva para assets (Cloudflare edge)
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/favicon.ico",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
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
    ],
  },
};

export default withPWA(nextConfig);
