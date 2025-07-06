#!/usr/bin/env bash
#list all existing tmux sessions (cleaner than tmux ls)

# # Ensure a session nubmer was provided
# if [[ -z "$1" ]]; then
#   echo "Usage: $0 <session_number>" >&2
#   exit 1
# fi

# # Ensure the argument is a number
# if ! [[ "$1" =~ ^[0-9]+$ ]]; then
#   echo "Error: <session_number> must be a number" >&2
#   exit 1
# fi

session_number="$1"

# list all sessions, if 
# - has-session returns 0 if session exists
SESSIONS=$(tmux ls | cut -d" " -f1 | sed 's/:$//')
if [ -z "$SESSIONS" ] ; then
  echo "Error: There are no existing tmux sessions running."
  echo "Run ./join_station <station_number> to start one"
else
  echo "$SESSIONS"
fi