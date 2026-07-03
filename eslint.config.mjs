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
];

export default eslintConfig;
