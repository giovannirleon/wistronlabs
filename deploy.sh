#!/bin/bash
set -euo pipefail

# Script location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
NC='\033[0m' # No Color

err() {
    echo -e "${RED}Error:${NC} $*" >&2
}

# Define available locations, base domain, SSH user, and SSH options
LOCATIONS=("TSS" "FRK")
BASE_URL="wistronlabs.com"
USER="falab"

SCRIPTS_DIR="$SCRIPT_DIR/scripts"
REMOTE_SCRIPTS_DIR="/home/$USER/scripts"


SSH_OPTS="-o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=5"

cd "$SCRIPT_DIR" || { err "Failed to cd to script dir"; exit 1; }

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

# authorization check
echo ""
echo "============================================================"
echo "Pre-flight Authorization check for all locations..."
echo "============================================================"

failed_locs=()

for loc in "${LOCATIONS[@]}"; do
    echo "Checking auth for $loc.$BASE_URL ..."
    if ! ssh $SSH_OPTS "$USER@$loc.$BASE_URL" "echo 'Auth OK for $loc' >/dev/null"; then
        err "Auth failed for $loc.$BASE_URL."
        failed_locs+=("$loc")
    fi
done

if ((${#failed_locs[@]} > 0)); then
    echo ""
    err "Pre-flight Auth check FAILED for: ${failed_locs[*]}"
    echo "Fix Auth issues for those locations and try again. Aborting without deploying."
    exit 1
fi

echo ""
echo "All locations passed authorization pre-flight check."
echo "Proceeding with deployments..."

# Loop through each location
for loc in "${LOCATIONS[@]}"; do

    echo ""
    echo "============================================================"
    echo ">>> Starting Frontend deployment for: $loc"
    echo "============================================================"
    echo ""

    # Change to frontend directory
    cd "$SCRIPT_DIR/website_frontend" || { err "Frontend folder does not exist"; exit 1; }

    # Write .env file for this location
    echo "Generating .env file for $loc..."
    cat > .env <<EOF
VITE_BACKEND_URL=https://backend.$loc.$BASE_URL/api/v1
VITE_URL=https://$loc.$BASE_URL/
VITE_LOCATION=$loc
EOF

    # Build frontend
    echo ""
    echo "Building frontend for $loc..."
    if ! npm run build; then
        err "npm build failed for $loc"
        exit 1
    fi

    # Change to dist folder
    cd "$SCRIPT_DIR/website_frontend/dist" || { err "Frontend dist folder does not exist"; exit 1; }

    # Clean up remote server
    echo ""
    echo "Connecting to $loc and cleaning up remote server..."
    if ! ssh $SSH_OPTS "$USER@$loc.$BASE_URL" "cd /var/www/html; rm -rf assets/; rm -f index.html"; then
        err "SSH connection failed for $loc — key authentication may be missing."
        exit 1
    fi
    echo "Remote cleanup complete for $loc."

    # Upload new build
    echo ""
    echo "Uploading new frontend build to $loc..."
    scp $SSH_OPTS -r assets/ index.html "$USER@$loc.$BASE_URL:/var/www/html"
    echo "Frontend build uploaded to $loc successfully."

    echo ""
    echo "============================================================"
    echo ">>> Frontend Deployment completed for: $loc"
    echo "============================================================"

    # Change to main directory
    cd "$SCRIPT_DIR" || { err "Main folder does not exist"; exit 1; }

    echo ""
    echo "============================================================"
    echo ">>> Starting backend deployment for: $loc"
    echo "============================================================"
    echo ""

    # # Ensure backup directory exists and is writable
    # ssh $SSH_OPTS "$USER@$loc.$BASE_URL" \
    #   "sudo mkdir -p /opt/docker/database_backups && sudo chown $USER /opt/docker/database_backups"

    # Backup database on remote server
    echo "Creating PostgreSQL database backup on $loc..."
    if ! ssh $SSH_OPTS "$USER@$loc.$BASE_URL" \
        "sudo docker exec -t website_backend-db-1 pg_dump -U postgres mydb > /opt/docker/database_backups/db_backup_$(date +%Y%m%d_%H%M%S).sql"; then
        echo "ERROR: Failed to create database backup on $loc"
        exit 1
    fi
    echo "Database backup created on $loc."

    # Stop old backend containers without deleting files
    echo ""
    echo "Stopping backend containers on $loc (without deleting files)..."
    ssh $SSH_OPTS "$USER@$loc.$BASE_URL" \
        "cd /opt/docker/website_backend 2>/dev/null && sudo docker compose down || true"

    # Upload new backend code using rsync, excluding .env
    echo ""
    echo "Uploading fresh backend code to $loc (preserving .env)..."
    if ! RSYNC_RSH="ssh $SSH_OPTS" rsync -av --delete --exclude='.env' \
        website_backend/ "$USER@$loc.$BASE_URL:/opt/docker/website_backend/"; then
        echo "ERROR: Failed to upload backend code to $loc"
        exit 1
    fi
    echo "Backend code uploaded to $loc."

  echo ""
  echo "Ensuring .env and secrets exist on $loc..."
  if ! ssh -T $SSH_OPTS "$USER@$loc.$BASE_URL" 'bash -s' <<'REMOTE'
cd /opt/docker/website_backend || { echo "Missing /opt/docker/website_backend" >&2; exit 1; }

# Ensure .env file exists
[ -f .env ] || touch .env

# Normalize line endings, but don't die if something is weird
if [ -s .env ]; then
  tr -d '\r' < .env > .env.tmp 2>/dev/null || cp .env .env.tmp
  mv .env.tmp .env 2>/dev/null || true
fi

ensure_newline() {
  if [ -s .env ]; then
    last_char=$(tail -c1 .env 2>/dev/null || echo "")
    [ -n "$last_char" ] || return 0
    echo >> .env
  fi
}

generate_base64() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 2>/dev/null || echo "fallback_b64_$(date +%s)"
  else
    head -c 48 /dev/urandom 2>/dev/null | base64 || echo "fallback_b64_$(date +%s)"
  fi
}

generate_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 2>/dev/null || echo "fallback_hex_$(date +%s)"
  else
    hexdump -vn 32 -e ' /1 "%02x"' /dev/urandom 2>/dev/null || echo "fallback_hex_$(date +%s)"
  fi
}

# --- DATABASE_URL ---
if ! grep -q '^DATABASE_URL=' .env; then
  echo "Setting DATABASE_URL..."
  ensure_newline
  echo "DATABASE_URL=postgres://postgres:example@db:5432/mydb" >> .env
fi

# --- PORT ---
if ! grep -q '^PORT=' .env; then
  echo "Setting PORT..."
  ensure_newline
  echo "PORT=3000" >> .env
fi

# --- JWT_SECRET ---
if ! grep -q '^JWT_SECRET=' .env; then
  echo "Generating new JWT_SECRET..."
  SECRET=$(generate_base64)
  ensure_newline
  echo "JWT_SECRET=$SECRET" >> .env
fi

# --- INTERNAL_API_KEY ---
if ! grep -q '^INTERNAL_API_KEY=' .env; then
  echo "Generating new INTERNAL_API_KEY..."
  APIKEY=$(generate_hex)
  ensure_newline
  echo "INTERNAL_API_KEY=$APIKEY" >> .env
fi

# --- WEBHOOK_TOKEN ---
if ! grep -q '^WEBHOOK_TOKEN=' .env; then
  echo "Generating new WEBHOOK_TOKEN..."
  TOKEN=$(generate_hex)
  ensure_newline
  echo "WEBHOOK_TOKEN=$TOKEN" >> .env
fi

# If we got here, everything is fine
exit 0
REMOTE
    then
      echo "ERROR: Remote .env/secret setup failed on $loc"
      exit 1
    fi



    # Start backend containers
    echo ""
    echo "Starting backend containers on $loc..."
    if ! ssh $SSH_OPTS "$USER@$loc.$BASE_URL" \
        "cd /opt/docker/website_backend; sudo docker compose up --build -d app"; then
        echo "ERROR: Failed to start backend containers on $loc"
        exit 1
    fi


    echo ""
    echo "============================================================"
    echo ">>> Backend deployment completed for: $loc"
    echo "============================================================"

      # Return to main script directory
    cd "$SCRIPT_DIR" || { err "Main folder does not exist"; exit 1; }

    echo ""
    echo "============================================================"
    echo ">>> Starting script deployment for: $loc"
    echo "============================================================"
    echo ""

    # Ensure local scripts directory exists
    if [[ ! -d "$SCRIPTS_DIR" ]]; then
      err "Local scripts directory '$SCRIPTS_DIR' does not exist."
      exit 1
    fi

    echo "Uploading scripts from $SCRIPTS_DIR to $USER@$loc.$BASE_URL:~ ..."
    if ! RSYNC_RSH="ssh $SSH_OPTS" rsync -av "$SCRIPTS_DIR/" "$USER@$loc.$BASE_URL:/home/$USER/"; then
      err "Failed to deploy scripts to $loc"
      exit 1
    fi

    echo ""
    echo "============================================================"
    echo ">>> Script deployment completed for: $loc"
    echo "============================================================"


    cd "$SCRIPT_DIR" || { err "Main folder does not exist"; exit 1; }
done

echo ""
echo "============================================================"
echo "All deployments completed successfully."
echo "============================================================"