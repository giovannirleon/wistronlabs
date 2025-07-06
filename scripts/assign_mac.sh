#!/usr/bin/env bash
# Usage: ./assign_mac.sh <mac_address> <mode>
MAC="$1"
MODE="$2"

CSV="/var/www/html/mac_mappings/${MODE}.csv"

MAC=$(echo "$MAC" | sed 's/../&:/g;s/:$//' | tr 'A-F' 'a-f')

if [[ ! "$MAC" =~ ^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$ ]]; then
  echo "Invalid MAC address"
  exit 1
fi

# Avoid duplicates
grep -iq "^$MAC," "$CSV" || echo "$MAC,${MODE}.cfg" >> "$CSV"
