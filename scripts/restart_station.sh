#!/usr/bin/env bash
#restart a non responsive tmux station

# Ensure a session name was provided
if [[ -z "$1" ]]; then
  echo "Usage: $0 <session_number>" >&2
  exit 1
fi

# Ensure the argument is a number
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  echo "Error: <session_number> must be a number" >&2
  exit 1
fi

session_number="$1"

# if a tmux session exists, kill it an restart, it if doesnt error out and list the existing sessions
# - has-session returns 0 if session exists
if tmux has-session -t "stn_$session_number" 2>/dev/null; then
  tmux kill-session -t "stn_$session_number"
  tmux new-session -s "stn_$session_number"
else
  echo "Error: this station does not exist, please pick from one of the below stations:"
  tmux ls | cut -d" " -f1 | sed 's/:$//'
fi