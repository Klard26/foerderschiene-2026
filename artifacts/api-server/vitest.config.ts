import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Mirror the esbuild build's text loaders (.hbs / .sql) so tests that import
// modules pulling in email templates or bundled SQL resolve them as strings.
function rawTextLoader(): Plugin {
  return {
    name: "raw-text-loader",
    enforce: "pre",
    load(id) {
      const [filePath] = id.split("?");
      if (filePath && (filePath.endsWith(".hbs") || filePath.endsWith(".sql"))) {
        const source = readFileSync(filePath, "utf8");
        return `export default ${JSON.stringify(source)};`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [rawTextLoader()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.ts"],
  },
});
