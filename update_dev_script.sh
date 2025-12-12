#!/bin/bash
set -euo pipefail

# Usage:
#   ./update_dev_script.sh <local-script-name>
#
# Example:
#   ./update_dev_script.sh my_test_script.sh
#
# This will:
#   - let you pick TSS or FRK via fzf
#   - copy ./scripts/<local-script-name> to <loc>.wistronlabs.com:/opt/dev_scripts/
#   - chmod +x it

REMOTE_USER="falab"
REMOTE_DIR="/opt/dev_scripts"

LOCAL_SCRIPT="${1:-}"

SSH_OPTS="${SSH_OPTS:--o BatchMode=yes -o ConnectTimeout=5}"

if [[ -z "$LOCAL_SCRIPT" ]]; then
  echo "Usage: $0 <local-script-name>" >&2
  exit 1
fi

if [[ ! -f "scripts/$LOCAL_SCRIPT" ]]; then
  echo "Error: local script 'scripts/$LOCAL_SCRIPT' not found." >&2
  exit 1
fi

# Pick location with fzf
LOCATIONS=("TSS" "FRK")
echo "Select location:"
SELECTED_LOC="$(printf '%s\n' "${LOCATIONS[@]}" | fzf --prompt='Location> ' --height=5 --border)" || {
  echo "No location selected, aborting." >&2
  exit 1
}

# Map to hostname (lowercase + .wistronlabs.com)
LOWER_LOC="$(echo "$SELECTED_LOC" | tr '[:upper:]' '[:lower:]')"
REMOTE_HOST="${LOWER_LOC}.wistronlabs.com"

echo "==> Using location: $SELECTED_LOC ($REMOTE_HOST)"

echo "==> Ensuring remote dir $REMOTE_DIR exists on $REMOTE_USER@$REMOTE_HOST ..."
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"

echo "==> Copying scripts/$LOCAL_SCRIPT to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR ..."
scp $SSH_OPTS "scripts/$LOCAL_SCRIPT" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

REMOTE_BASENAME="$(basename "$LOCAL_SCRIPT")"

echo "==> Setting +x on $REMOTE_BASENAME on $REMOTE_HOST ..."
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "cd '$REMOTE_DIR' && chmod +x '$REMOTE_BASENAME'"

echo "==> Done."
