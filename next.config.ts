import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare quick tunnels use a different origin than the local dev server.
  // Allow their dev-only asset requests so browser-side spreadsheet parsing can
  // load when the app is shared beyond localhost.
  allowedDevOrigins: ["*.trycloudflare.com"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
