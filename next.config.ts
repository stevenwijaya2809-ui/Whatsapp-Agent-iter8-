import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server's hot reload work when the app is opened through the ngrok tunnel.
  // Only used by `next dev`; production builds ignore it.
  allowedDevOrigins: ["starboard-colonial-brisket.ngrok-free.dev"],
};

export default nextConfig;
