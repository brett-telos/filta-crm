const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// This workspace intentionally contains React 18 (Next.js CRM) and React 19
// (Expo 54). Prevent Metro's hierarchical resolver from pulling React 18 from
// the workspace root when it follows shared-package symlinks.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
};

module.exports = config;
