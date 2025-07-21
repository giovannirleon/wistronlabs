#!/bin/bash

# Backend deploy script with structured output and fzf location selection

LOCATIONS=("TSS" "FRK")  # adjust if you really deploy backend to multiple locations
BASE_URL="wistronlabs.com"
USER="falab"

echo "============================================================"
echo "Checking for unstaged or uncommitted changes in git..."
echo "============================================================"

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
        --prompt="Select backend locations to deploy: " \
        --bind "tab:toggle" \
        --header="TAB to toggle, ENTER to confirm")
    if [[ -z "$selected" ]]; then
        echo "ERROR: You must select at least one location."
    else
        echo ""
        echo "============================================================"
        echo "Deploying backend to the following locations:"
        echo "$selected"
        echo "============================================================"
        break
    fi
done

rm -r node_modules > /dev/null
rm package-lock.json > /dev/null

# Loop through each selected location
for loc in $selected; do

    echo ""
    echo "============================================================"
    echo ">>> Starting backend deployment for: $loc"
    echo "============================================================"
    echo ""

    # Backup database on remote server
    echo "Creating PostgreSQL database backup on $loc..."
    if ! ssh -o BatchMode=yes "$USER@$loc.$BASE_URL" \
        "sudo docker exec -t website_backend-db-1 pg_dump -U postgres mydb > /opt/docker/database_backups/db_backup_$(date +%Y%m%d_%H%M%S).sql"; then
        echo "ERROR: Failed to create database backup on $loc"
        exit 1
    fi
    echo "Database backup created on $loc."

    # Clean up remote containers and old code
    echo ""
    echo "Cleaning up old backend containers and code on $loc..."
    if ! ssh -o BatchMode=yes "$USER@$loc.$BASE_URL" \
        "cd /opt/docker/website_backend; sudo docker compose down; cd ..; rm -rf website_backend/"; then
        echo "ERROR: Failed to clean up old backend on $loc"
        exit 1
    fi
    echo "Old backend containers stopped and code removed on $loc."

    # Upload new backend code
    echo ""
    echo "Uploading fresh backend code to $loc..."
    cd ..
    if ! scp -r website_backend/ "$USER@$loc.$BASE_URL:/opt/docker"; then
        echo "ERROR: Failed to upload backend code to $loc"
        exit 1
    fi
    cd website_backend
    echo "Backend code uploaded to $loc."

    # Start backend containers
    echo ""
    echo "Starting backend containers on $loc..."
    if ! ssh -o BatchMode=yes "$USER@$loc.$BASE_URL" \
        "cd /opt/docker/website_backend; sudo docker compose up --build -d app"; then
        echo "ERROR: Failed to start backend containers on $loc"
        exit 1
    fi
    echo ""
    echo "============================================================"
    echo ">>> Backend deployment completed for: $loc"
    echo "============================================================"

done

echo ""
echo "============================================================"
echo "All backend deployments completed successfully."
echo "============================================================"
