const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Without this, Metro ignores package.json "exports" conditions and resolves
// axios to its Node.js build (lib/platform/node/*), which references the
// `form-data` npm package and crashes at JS-bundle-evaluation time with
// "ReferenceError: Property 'FormData' doesn't exist" on a release/Hermes
// build (never surfaced in dev-client mode since Metro serves JS differently
// there). axios's package.json already declares a correct "react-native"
// export condition pointing at its browser-safe build — Metro just needs to
// be told to honor it.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'require', 'default'];

module.exports = config;
