import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client"],
  transpilePackages: ["swagger-ui-react"],
};

export default nextConfig;
