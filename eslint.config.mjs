import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import reactHooks from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";

const eslintConfig = [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "functions/lib/**",
      "public/**",
      "**/.kilo/**",
      "**/.freebuff/**",
      "**/.zcode/**",
      "**/.vercel/**",
      "**/.kilocode/**",
      "out/**",
      "dist/**",
      "build/**",
    ],
  },
  {
    plugins: {
      "react-hooks": reactHooks,
      import: importPlugin,
    },
  },
  ...nextCoreWebVitals,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "import/no-anonymous-default-export": "warn",
       "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];

export default eslintConfig;
