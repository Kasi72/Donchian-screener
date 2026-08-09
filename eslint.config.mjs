import nextVitals from "eslint-config-next/core-web-vitals";

const config = [...nextVitals, { ignores: [".next-e2e/**"] }];

export default config;
