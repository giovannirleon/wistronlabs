#!/bin/bash

URL="tss.wistronlabs.com"
USER="falab"

if [[ -z "$1" ]]; then
    echo "❌ Error: Missing password argument."
    echo "Usage: ./deploy <ssh_password>"
    exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
    echo "❌ sshpass is not installed on this machine."
    echo ""
    echo "➡️  Install sshpass:"
    echo "   On Ubuntu/Debian:"
    echo "     sudo apt-get install sshpass"
    echo ""
    echo "   On macOS (with Homebrew):"
    echo "     brew install hudochenkov/sshpass/sshpass"
    exit 1
fi

echo "🔷 Cleaning up remote server environment: stopping and removing old containers, and removing old backend code…"
sshpass -p "$1" ssh $USER@$URL \
  "cd /opt/docker/website_backend; sudo docker compose down -v; cd ..; rm -rf website_backend/;"

echo "✅ Remote cleanup complete."

echo "🔷 Uploading fresh backend code to remote server…"
cd ..
sshpass -p "$1" scp -r website_backend/ $USER@$URL:/opt/docker

echo "✅ Backend code uploaded successfully."

echo "🔷 Starting new backend containers on remote server with a fresh build…"
sshpass -p "$1" ssh $USER@$URL \
  "cd /opt/docker/website_backend; sudo docker compose up --build -d"

echo "✅ Deployment complete. The backend is now up and running."

cd website_backend
