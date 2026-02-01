#!/bin/sh

# Replace environment placeholders in env-config.js
ENV_CONFIG_FILE="/usr/share/nginx/html/env-config.js"

# Set defaults if not provided (empty = use relative /api paths)
VITE_API_URL="${VITE_API_URL:-}"
VITE_CUSTOM_DOMAIN="${VITE_CUSTOM_DOMAIN:-notesvnn.click}"

# Replace placeholders with actual values
sed -i "s|VITE_API_URL: ''|VITE_API_URL: '${VITE_API_URL}'|g" "$ENV_CONFIG_FILE"
sed -i "s|__VITE_CUSTOM_DOMAIN__|${VITE_CUSTOM_DOMAIN}|g" "$ENV_CONFIG_FILE"

echo "Environment configuration applied:"
cat "$ENV_CONFIG_FILE"

# Start nginx
exec nginx -g 'daemon off;'