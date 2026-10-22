import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM build that must not be bundled by Turbopack — it has to
  // stay a real node_modules dependency at runtime (local dev without Postgres).
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
