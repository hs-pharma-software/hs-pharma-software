import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This app's screens are almost all "load from local SQLite on mount"
      // (see src/lib/repo + the isTauri() guard pattern used throughout
      // src/app/**/page.tsx) — the idiomatic React shape for that is a
      // useEffect that calls an async loader which setStates the result.
      // react-hooks/set-state-in-effect flags that exact pattern, which
      // would mean disabling it inline in dozens of files, so it's turned
      // off project-wide instead.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Rust build artifacts (generated JS glue code, not app source).
    "src-tauri/target/**",
  ]),
]);

export default eslintConfig;
