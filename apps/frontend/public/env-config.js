// Runtime environment configuration
// This file is replaced at container startup by docker-entrypoint.sh
window.__ENV__ = {
  VITE_API_URL: '',  // Empty: endpoints already include /api prefix
  VITE_CUSTOM_DOMAIN: '__VITE_CUSTOM_DOMAIN__',
};