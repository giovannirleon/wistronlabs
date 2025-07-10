#!/bin/bash

URL="tss.wistronlabs.com"
USER="falab"



if [[ -z "$1" ]]; then
    echo "❌ Error: Missing password argument."
    echo "Usage: ./deploy <ssh_password>"
    exit 1
fi

npm run build

cd dist || { echo "❌ dist folder does not exist"; exit 1; }

if ! command -v sshpass >/dev/null 2>&1; then
    echo "❌ sshpass is not installed on this machine."
    echo ""
    echo "➡️  Install sshpass:"
    echo "   On Ubuntu/Debian:"
    echo "     sudo apt-get install sshpass"
    echo ""
    echo "   On macOS (with Homebrew):"
    echo "     brew install hudochenkov/sshpass"
    exit 1
fi

echo "🔷 Cleaning up remote server environment: removing old frontend code…"
sshpass -p "$1" ssh "$USER@$URL" \
  "cd /var/www/html; rm -rf assets/; rm -f index.html"

echo "✅ Remote cleanup complete."

echo "🔷 Uploading fresh frontend code to remote server…"
sshpass -p "$1" scp -r assets/ "$USER@$URL:/var/www/html"
sshpass -p "$1" scp index.html "$USER@$URL:/var/www/html"

echo "✅ Frontend code uploaded successfully."
echo "🚀 Deployment complete."
