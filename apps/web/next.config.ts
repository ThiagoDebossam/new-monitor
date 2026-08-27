import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pulse/db", "@pulse/emails"],
};

export default nextConfig;
