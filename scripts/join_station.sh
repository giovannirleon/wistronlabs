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

# Check if SERVER_LOCATION environment variable is set
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
found=0

for station in "${STATIONS[@]}"; do
  if [[ "$station" == "$session_number" ]]; then
    found=1
    break
  fi
done

if [[ $found -eq 0 ]]; then
  err "stn_$session_number does not exist. Please choose from one of the below stations:"
  cols=6

  i=0
  for stn in "${STATIONS[@]}"; do
      printf "%-9s" "stn_$stn"
      ((i++))
      if (( i % cols == 0 )); then
          echo
      fi
  done
  # finish with newline if needed
  if (( i % cols != 0 )); then
      echo
  fi

  exit 1
fi

# Try to attach to an existing session; if it fails, create a new one
# - has-session returns 0 if session exists
if tmux has-session -t "stn_$session_number" 2>/dev/null; then
  tmux attach-session -t "stn_$session_number"
else
  tmux new-session -s "stn_$session_number"
fi
