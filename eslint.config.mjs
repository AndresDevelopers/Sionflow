import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "functions/lib/**",
      "public/**",
    ],
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
