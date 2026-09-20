// Backend lint config. Structure deliberately mirrors `feature/Registration`'s
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
  {
    // Tests are ES modules: they import { test, expect, vi } from "vitest"
    // explicitly, so no test-runner globals are needed here — only node's.
    // The modules under test stay CommonJS and are pulled in with
    // createRequire, which is why `require` still appears inside these files.
    files: ["tests/**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      globals: globals.node,
    },
    rules: {
      // A test that builds a value and never asserts on it is a silent pass.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { files: ["tests/unit/equipment/**/*.js"], languageOptions: { sourceType: "commonjs" } },
];
