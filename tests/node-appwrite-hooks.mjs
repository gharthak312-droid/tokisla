// Node module-customization hooks for tests/functions.merged-actions.test.mjs.
// Redirects the bare `node-appwrite` import in functions/api/index.js to
// the in-test stub (tests/node-appwrite-stub.mjs). No dependency is
// installed and no network is used; the stub is test-only.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "node-appwrite") {
    return {
      url: new URL("./node-appwrite-stub.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
