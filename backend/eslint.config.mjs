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
    // Tests import { test, before, beforeEach, mock } from "node:test"
    // explicitly, so no test-runner globals are needed here — only node's.
    files: ["tests/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      // A test that builds a value and never asserts on it is a silent pass.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
