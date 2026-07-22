import type { NextConfig } from "next";
import { browserSecurityHeaders, strictTransportSecurity } from "./lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...browserSecurityHeaders, strictTransportSecurity],
      },
    ];
  },
};

export default nextConfig;
