// Svelte's runtime reads its environment through `esm-env`, whose conditions
// are resolved by the bundler. GJS answers to none of them, so the build aliases
// the package to this: a browser-like target with dev checks compiled out.

export const DEV = false;
export const BROWSER = true;
