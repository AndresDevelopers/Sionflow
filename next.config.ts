
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
