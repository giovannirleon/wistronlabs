#!/bin/bash

RED='\033[0;31m'
NC='\033[0m' # No Color

err() {
    echo -e "${RED}Error:${NC} $*" >&2
}

# Check if SERVER_LOCATION environment variable is set
if [[ -z "${SERVER_LOCATION:-}" ]]; then
  err "Environment variable SERVER_LOCATION is not set." >&2
  echo "       Please export SERVER_LOCATION in your shell (e.g. in ~/.bashrc)." >&2
  exit 1
fi

# Check if INTERNAL_API_KEY environment variable is set
if [[ -z "${INTERNAL_API_KEY:-}" ]]; then
  echo "Error: environment variable INTERNAL_API_KEY is not set." >&2
  echo "       Please export INTERNAL_API_KEY in your shell (e.g. in ~/.bashrc)." >&2
  exit 1
fi

# Fetch station names
# Require jq
if ! command -v jq >/dev/null 2>&1; then
  err "jq is required but not installed." >&2
  exit 1
fi

# Get JSON from API
if ! json=$(curl -fsS --max-time 5 "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations"); then
  err "Unable to reach backend" >&2
  exit 1
fi

# Parse station_name into a bash array
mapfile -t STATIONS < <(printf '%s\n' "$json" | jq -r '.[].station_name')

# Sanity check
if ((${#STATIONS[@]} == 0)); then
  err "No stations found in API response." >&2
  exit 1
fi

SCRIPT_NAME="$(basename "$0")"

if [[ "${1:-}" == "-l" ]]; then
  echo "Available stations for $SERVER_LOCATION:"
  printf '%s\n' "${STATIONS[@]}" | nl -w2 -s') '
  echo
  echo "To join a station, run:"
  echo "  $SCRIPT_NAME <station_name>"
  exit 0
fi

# Ensure a session number was provided
if [[ -z "${1:-}" ]]; then
  echo "Usage: $SCRIPT_NAME <session_number>" >&2
  echo "  session_number: ID of the station to join" >&2
  echo "  To list stations, run $SCRIPT_NAME -l" >&2
  exit 1
fi

# Ensure the argument is a number
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  err "session_number must be a number" >&2
  exit 1
fi

session_number="$1"

# if a tmux session exists, kill it and restart, if it doesn't error out and list the existing sessions
# - has-session returns 0 if session exists
if tmux has-session -t "stn_$session_number" 2>/dev/null; then
  tmux kill-session -t "stn_$session_number"
  tmux new-session -s "stn_$session_number"
else
  echo "Error: this station does not exist, please pick from one of the below stations:"

  # Collect tmux sessions whose numeric suffix is in STATIONS[]
  valid_sessions=()

  # List tmux session names only; ignore errors if no sessions
  while IFS= read -r sess; do
    # Expect session names like stn_1, stn_2, etc.
    if [[ "$sess" =~ ^stn_([0-9]+)$ ]]; then
      num="${BASH_REMATCH[1]}"
      # Check if num is in STATIONS array
      for stn in "${STATIONS[@]}"; do
        if [[ "$stn" == "$num" ]]; then
          valid_sessions+=("$sess")
          break
        fi
      done
    fi
  done < <(tmux ls -F '#S' 2>/dev/null || true)

  if ((${#valid_sessions[@]} == 0)); then
    echo "  (No active tmux station sessions match API stations.)"
  else
    printf '%s\n' "${valid_sessions[@]}"
  fi
fi
