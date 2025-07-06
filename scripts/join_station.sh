#!/bin/bash

# Ensure a session name was provided
if [[ -z "$1" ]]; then
  echo "Usage: $0 <session_number>" >&2
  echo "  station_number: Numeric ID of the station to join" >&2
  exit 1
fi

# Ensure the argument is a number
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  echo "Error: session_number must be a number" >&2
  exit 1
fi

echo "set station number as first arguement"
session_number="$1"

# Try to attach to an existing session; if it fails, create a new one
# - has-session returns 0 if session exists
if tmux has-session -t "stn_$session_number" 2>/dev/null; then
  tmux attach-session -t "stn_$session_number"
else
  tmux new-session -s "stn_$session_number"
fi