import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    // The explorer used to live at /explore; query strings are passed through.
    return [{ source: "/explore", destination: "/", permanent: false }];
  },
};

export default nextConfig;
