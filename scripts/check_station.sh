#!/bin/bash

STATION_NAME="$1"
if [ -z "$STATION_NAME" ]; then
  echo "Usage: $0 <station_name>"
  exit 1
fi


BASH_PID=$(tmux list-panes -a -F "#{pane_pid} #{session_name}:#{window_index}.#{pane_index}" | grep -w "$STATION_NAME" | cut -d" " -f1)

NORMALIZED_NAME=$(for w in ${STATION_NAME//[^[:alnum:]]/ }; do printf '%s ' "${w^}"; done | sed 's/ $//')


if [ -z "$BASH_PID" ]; then

  # emit JSON
  printf '{\n'
  printf '  "station": "%s",\n' "$NORMALIZED_NAME"
  printf '  "status": %d,\n'    "2"
  # escape any quotes in the message
  escaped_msg=${MESSAGE//\"/\\\"}
  printf '  "message": "%s"\n'  "No existing tmux session for $NORMALIZED_NAME."
  printf '}\n'
  exit 1
fi

NEWEST_CHILD=$(pgrep -P "$BASH_PID" -afn)
if [ -z "$NEWEST_CHILD" ]; then

  CODE="0"
  MESSAGE="L10 Diagnostic Test is not running."
elif [ $(echo $NEWEST_CHILD | cut -d" " -f3) ==  "./l10_test.sh" ]; then
  NEWEST_CHILD_PID=$(echo $NEWEST_CHILD | cut -d" " -f1)
  PID_INFO=$(cat /proc/$NEWEST_CHILD_PID/stat | cut -d" " -f3)
  
  if [ "$PID_INFO" == "T" ]; then
    CODE="0"
    MESSAGE="L10 Diagnostic Test is not running."

  else
    CODE="1"
    MESSAGE="L10 Diagnostic Test is running."
  fi

elif [ $(echo $NEWEST_CHILD | cut -d" " -f3) ==  "./gb300_l10_test.sh" ]; then
  NEWEST_CHILD_PID=$(echo $NEWEST_CHILD | cut -d" " -f1)
  PID_INFO=$(cat /proc/$NEWEST_CHILD_PID/stat | cut -d" " -f3)
  
  if [ "$PID_INFO" == "T" ]; then
    CODE="0"
    MESSAGE="L10 Diagnostic Test is not running."

  else
    CODE="1"
    MESSAGE=" GB300 L10 Diagnostic Test is running."
  fi

else
  CODE="0"
  MESSAGE="L10 Diagnostic Test is not running."
fi

# emit JSON
printf '{\n'
printf '  "station": "%s",\n' "$NORMALIZED_NAME"
printf '  "status": %d,\n'    "$CODE"
# escape any quotes in the message
escaped_msg=${MESSAGE//\"/\\\"}
printf '  "message": "%s"\n'  "$escaped_msg"
printf '}\n'