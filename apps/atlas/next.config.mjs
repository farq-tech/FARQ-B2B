/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    agentUpgrade: 'security',
  },
  images: {
    unoptimized: true,
  },
  // the insight tools live as tabs on the map (components/lens); old links land on the same tool
  async redirects() {
    return [
      { source: '/insights', destination: '/map?tool=district', permanent: false },
      { source: '/insights/report', destination: '/map?tool=district', permanent: false },
      { source: '/insights/around', destination: '/map?tool=around', permanent: false },
      { source: '/insights/growth', destination: '/map?tool=growth', permanent: false },
      { source: '/insights/territories', destination: '/map?tool=territories', permanent: false },
      { source: '/market-gaps', destination: '/map?tool=gaps', permanent: false },
      // «السوق» was a prebuilt bundle; its business search and requests now live on the map (components/lens)
      { source: '/opportunity-map', destination: '/map', permanent: false },
    ]
  },
}

export default nextConfig
