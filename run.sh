#!/bin/sh
echo "========================"
echo "        cine-web        "
echo "========================"
echo "1. Dev mode (localhost:5173)"
echo "2. Production (localhost:3001)"

echo ""
printf "Select (1 or 2): "
read -r choice

if [ "$choice" = "1" ]; then
  npm install > /dev/null 2>&1
  echo "Starting in DEV mode at http://localhost:5173"
  exec npm run dev
fi

npm install > /dev/null 2>&1
npm run build > /dev/null 2>&1
echo "Starting in PRODUCTION mode at http://localhost:3001"
exec node server.js
