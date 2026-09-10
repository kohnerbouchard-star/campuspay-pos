import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [{ source: '/favicon.ico', destination: '/icon.svg', permanent: true }]
  },
}

export default nextConfig
