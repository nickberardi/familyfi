import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client"],
  // The UniFi mock reads these from disk (src/server/unifi/dev-mock.ts), so tracing would ship them in
  // every image. Only the hosted demo's image carries them; getfamilyfi.com adds them to a release.
  outputFileTracingExcludes: { "/*": ["tests/fixtures/**"] },
  // Shared components in src/ui are written with React Native primitives: the native app renders
  // them natively, the web through react-native-web. `.web.*` files win over shared ones here.
  turbopack: {
    resolveAlias: { "react-native": "react-native-web" },
    resolveExtensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
};

export default nextConfig;
