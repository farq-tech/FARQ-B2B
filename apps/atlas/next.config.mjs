/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce the minimal runtime used by Railway instead of shipping the full
  // build-time dependency tree with every Atlas release.
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
