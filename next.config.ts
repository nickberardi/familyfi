import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client"],
  // The UniFi mock reads these from disk (src/server/unifi/dev-mock.ts), so tracing would ship them in
  // every image. Only the demo image carries them, through docker/Dockerfile's demo target.
  outputFileTracingExcludes: { "/*": ["tests/fixtures/**"] },
  // `src/proxy.ts` makes Next buffer request bodies, and past this size it silently passes on only the
  // first part. A household import is up to 50 MB (IMPORT_MAX_BYTES in src/server/household-export.ts),
  // which the import route enforces itself.
  experimental: { proxyClientMaxBodySize: "52mb" },
  // Shared components in src/ui are written with React Native primitives: the native app renders
  // them natively, the web through react-native-web. `.web.*` files win over shared ones here.
  turbopack: {
    resolveAlias: { "react-native": "react-native-web" },
    resolveExtensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
};

export default nextConfig;
