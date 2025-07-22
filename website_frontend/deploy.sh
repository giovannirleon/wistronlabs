#!/bin/bash

# Define available locations, base domain, and SSH user
LOCATIONS=("TSS" "FRK")
BASE_URL="wistronlabs.com"
USER="falab"

echo "============================================================"
echo "Checking for unstaged or uncommitted changes in git..."
echo "============================================================"

# Check that fzf is installed
if ! command -v fzf >/dev/null 2>&1; then
    echo "ERROR: fzf is not installed. Please install fzf and try again."
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: You have unstaged or uncommitted changes."
    echo ""
    git status -s
    echo "Please commit or stash your changes before running this script."
    exit 1
fi

# Prompt user to select one or more locations
while true; do
    selected=$(printf "%s\n" "${LOCATIONS[@]}" | fzf --multi \
        --prompt="Select locations to deploy: " \
        --bind "tab:toggle" \
        --header="TAB to toggle, ENTER to confirm")
    if [[ -z "$selected" ]]; then
        echo "ERROR: You must select at least one location."
    else
        echo ""
        echo "============================================================"
        echo "Deploying to the following locations:"
        echo "$selected"
        echo "============================================================"
        break
    fi
done

# Loop through each selected location
for loc in $selected; do

    echo ""
    echo "============================================================"
    echo ">>> Starting deployment for: $loc"
    echo "============================================================"
    echo ""

    # Write .env file for this location
    echo "Generating .env file for $loc..."
    cat > .env <<EOF
VITE_BACKEND_URL=https://backend.$loc.wistronlabs.com/api/v1
VITE_URL=https://$loc.wistronlabs.com/
VITE_LOCATION="$loc"
EOF

    # Build frontend
    echo ""
    echo "Building frontend for $loc..."
    if ! npm run build; then
        echo "ERROR: npm build failed for $loc"
        exit 1
    fi

    cd dist || { echo "ERROR: dist folder does not exist"; exit 1; }

    # Clean up remote server
    echo ""
    echo "Connecting to $loc and cleaning up remote server..."
    if ! ssh -o BatchMode=yes "$USER@$loc.$BASE_URL" "cd /var/www/html; rm -rf assets/; rm -f index.html"; then
        echo "ERROR: SSH connection failed for $loc — key authentication may be missing."
        exit 1
    fi
    echo "Remote cleanup complete for $loc."

    # Upload new build
    echo ""
    echo "Uploading new frontend build to $loc..."
    scp -r assets/ "$USER@$loc.$BASE_URL:/var/www/html"
    scp index.html "$USER@$loc.$BASE_URL:/var/www/html"
    echo "Frontend build uploaded to $loc successfully."

    echo ""
    echo "============================================================"
    echo ">>> Deployment completed for: $loc"
    echo "============================================================"

    # Return to project root for next loop
    cd ..
done

echo ""
echo "============================================================"
echo "All deployments completed successfully."
echo "============================================================"
