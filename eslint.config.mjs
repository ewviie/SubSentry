import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: ["drizzle/**", ".claude/**"],
  },
];

export default config;
