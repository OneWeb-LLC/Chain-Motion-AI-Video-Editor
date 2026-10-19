/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path((?!auth/|sso/|satellite/|library/|backend/).*)',
        destination: '/api/backend/:path',
      },
    ];
  },
};

export default nextConfig;
