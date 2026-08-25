import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/jobs",
        destination: "/dashboard/reels",
        permanent: true,
      },
      {
        source: "/jobs/:path*",
        destination: "/dashboard/reels",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
