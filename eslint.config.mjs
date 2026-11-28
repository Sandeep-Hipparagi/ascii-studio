import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'next-env.d.ts',
      'analysis_scratchpad/**',
      'rea/**',
    ],
  },
  ...nextCoreWebVitals,
];

export default eslintConfig;
