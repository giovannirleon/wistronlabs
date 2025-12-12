#!/bin/bash

# Check if exactly two arguments are provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 <-i IP_ADDRESS | -m MAC_ADDRESS>"
    echo "  -i    Specify BMC using its IP address"
    echo "  -m    Specify BMC using its MAC address"
    exit 1
fi

ADDRESS_TYPE="$1"
ADDRESS_VALUE="$2"

# Simple validation for IP address format
if [[ "$ADDRESS_TYPE" = "-i" ]]; then

    if ! [[ "$ADDRESS_VALUE" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
        echo "Error: Invalid IP address format."
        echo "Needs to be in 123.456.789.012 format"
        exit 1
    fi

    IP="$ADDRESS_VALUE"

    MAC=$(awk -v ip="$ADDRESS_VALUE" '
        $1 == "lease" && $2 == ip {found=1}
        found && /hardware ethernet/ {gsub(";", "", $3); print $3; exit}
    ' /var/lib/dhcp/dhcpd.leases)

    if [[ -z "$MAC" ]]; then
        echo "There is no system with that IP"
        echo "Please check the IP address or wait for a lease to appear"
        exit 1
    fi

elif [[ "$ADDRESS_TYPE" = "-m" ]]; then

    if ! [[ "$ADDRESS_VALUE" =~ ^[A-Fa-f0-9]{12}$ ]]; then
        echo "Error: Invalid MAC address format."
        echo "Needs to be in 001A2B3C4D5E format"
        exit 1
    fi

    # Normalize to aa:bb:cc:dd:ee:ff
    ADDRESS_VALUE=$(echo "$ADDRESS_VALUE" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')

    IP=$(awk -v mac="$ADDRESS_VALUE" '
        /lease/ {ip=$2}
        /hardware ethernet/ {
            gsub(";", "", $3)
            if ($3 == mac) last_ip = ip
        }
        END { if (last_ip != "") print last_ip }
    ' /var/lib/dhcp/dhcpd.leases)

    if [[ -z "$IP" ]]; then
        echo "Error: The MAC Address given does not have a valid IP yet"
        echo "please wait for an IP address to be assigned or recheck your mac"
        exit 1
    fi

    MAC="$ADDRESS_VALUE"
else
    echo "Error: Invalid type, must either be -i (ip address) or -m (mac address)"
    exit 1
fi

MAC_NO_COLONS="${MAC//:/}"
MAC_LAST_6="${MAC_NO_COLONS: -6}"
SESSION_NAME="bs_${MAC_NO_COLONS}"

# If session already exists, just attach (no sol deactivate!)
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux attach -t "$SESSION_NAME"
    exit 0
fi

# No existing session: clean up any stale SOL once, then start a new tmux session
ipmitool -I lanplus -U admin -P admin -H "$IP" sol deactivate >/dev/null 2>&1 || true

tmux new-session -s "$SESSION_NAME" "ipmitool -I lanplus -U admin -P admin -H $IP sol activate"
