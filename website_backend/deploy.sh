#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Backend deploy script with structured output and fzf location selection

LOCATIONS=("TSS" "FRK")  # adjust if you really deploy backend to multiple locations
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

rm -rf "$SCRIPT_DIR/node_modules" "$SCRIPT_DIR/package-lock.json" >/dev/null 2>&1

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

    # Stop old backend containers without deleting files
    echo ""
    echo "Stopping backend containers on $loc (without deleting files)..."
    ssh -o BatchMode=yes "$USER@$loc.$BASE_URL" \
        "cd /opt/docker/website_backend 2>/dev/null && sudo docker compose down || true"

    # Upload new backend code using rsync, excluding .env
    echo ""
    echo "Uploading fresh backend code to $loc (preserving .env)..."
    cd ..
    if ! rsync -av --delete --exclude='.env' website_backend/ "$USER@$loc.$BASE_URL:/opt/docker/website_backend/"; then
        echo "ERROR: Failed to upload backend code to $loc"
        exit 1
    fi
    cd website_backend
    echo "Backend code uploaded to $loc."

    # Ensure .env contains DB/port and secrets (only add if missing)
    ssh -o BatchMode=yes "$USER@$loc.$BASE_URL" bash -c "'
    set -e
    cd /opt/docker/website_backend

    [ -f .env ] || touch .env
    tr -d \"\\r\" < .env > .env.tmp && mv .env.tmp .env

    ensure_newline() {
      [ -s .env ] && [ \"\$(tail -c1 .env)\" != \"\" ] && echo >> .env
    }

    # --- DATABASE_URL ---
    if ! grep -q \"^DATABASE_URL=\" .env; then
      echo \"Setting DATABASE_URL...\"
      ensure_newline
      echo \"DATABASE_URL=postgres://postgres:example@db:5432/mydb\" >> .env
    fi

    # --- PORT ---
    if ! grep -q \"^PORT=\" .env; then
      echo \"Setting PORT...\"
      ensure_newline
      echo \"PORT=3000\" >> .env
    fi

    # --- JWT_SECRET ---
    if ! grep -q \"^JWT_SECRET=\" .env; then
      echo \"Generating new JWT_SECRET...\"
      SECRET=\$(openssl rand -base64 48)
      ensure_newline
      echo \"JWT_SECRET=\$SECRET\" >> .env
    fi

    # --- INTERNAL_API_KEY ---
    if ! grep -q \"^INTERNAL_API_KEY=\" .env; then
      echo \"Generating new INTERNAL_API_KEY...\"
      APIKEY=\$(openssl rand -hex 32)
      ensure_newline
      echo \"INTERNAL_API_KEY=\$APIKEY\" >> .env
    fi
    '"

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
