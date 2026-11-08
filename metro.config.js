// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// On the web, tslib's ES-module entry (picked through package "exports")
// has no default export, and Supabase's helpers read `tslib.default`, so the
// web app crashed on load ("Cannot destructure property '__extends'…").
// Use tslib's CommonJS build instead. Needed for the public approval page.
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (moduleName === 'tslib') {
    return resolve({ ...context, unstable_enablePackageExports: false, mainFields: ['main'] }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
