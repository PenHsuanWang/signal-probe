// Type shim: plotly.js-dist-min is a pre-built browser bundle with the same
// public API as plotly.js but ships without TypeScript declarations.
// Reuse plotly.js declarations so imports type-check correctly.
declare module 'plotly.js-dist-min' {
  export { default } from 'plotly.js';
  export * from 'plotly.js';
}
