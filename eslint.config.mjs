import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // react-three-fiber render loops mutate preallocated objects on purpose
    // (zero allocations per frame); the compiler-oriented purity rules would
    // force React state into the 60fps hot path.
    files: ["components/**/*.tsx"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      // procedural geometry (random star positions) is generated in useMemo
      // on purpose — it must allocate once, not on every render
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
