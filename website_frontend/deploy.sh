#!/bin/bash


LOCATIONS=("TSS" "FRK")
BASE_URL="wistronlabs.com"
USER="falab"

echo "🔷 Checking for unstaged or uncommitted changes…"
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ Error: You have unstaged or uncommitted changes."
    echo ""
    git status -s
    echo "Please commit or stash your changes before running this script."
    exit 1
fi

while true; do
        selected=$(printf "%s\n" "${LOCATIONS[@]}" | fzf --multi \
        --prompt="Select options: " \
        --bind "tab:toggle" \
        --header="TAB to toggle, ENTER to confirm")
        if [[ -z "$selected" ]]; then
            echo "Error - you must pick at least location"
        else
            echo "INFO - Only running:"
            echo "$selected"
            break
        fi
    done


for loc in $selected; do

echo "Building Front end for $loc"

cat > .env <<EOF
VITE_BACKEND_URL=https://backend.$loc.wistronlabs.com/api/v1
VITE_URL=https://$loc.wistronlabs.com/
VITE_LOCATION="$loc"
EOF

npm run build

cd dist || { echo "Error: dist folder does not exist"; exit 1; }

echo "Cleaning up remote server environment: removing old frontend code…"
if ! ssh -o BatchMode=yes "$USER@$loc.$BASE_URL" "cd /var/www/html; rm -rf assets/; rm -f index.html"; then
    echo "Error: SSH failed for $loc — key authentication may be missing."
    exit 1
fi

echo "✅ Remote cleanup for $loc complete."

echo "Uploading fresh frontend code to remote server…"
scp -r assets/ "$USER@$loc.$BASE_URL:/var/www/html"
scp index.html "$USER@$loc.$BASE_URL:/var/www/html"

echo "✅ Frontend code uploaded successfully."
echo "🚀 Deployment complete."
cd ..
done


