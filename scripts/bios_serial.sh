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

    IP=$ADDRESS_VALUE

elif [[ "$ADDRESS_TYPE" = "-m" ]]; then

    if ! [[ "$ADDRESS_VALUE" =~ ^[A-Fa-f0-9]{12}$ ]]; then
        echo "Error: Invalid MAC address format."
        echo "Needs to be in 001A2B3C4D5E format"
        exit 1
    fi

    ADDRESS_VALUE=$(echo "$ADDRESS_VALUE" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')

    IP=$(awk -v mac="$ADDRESS_VALUE" '
        /lease/ {ip=$2} 
        /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip} 
        found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -z "$IP" ]]; then
        echo "Error: The MAC Address given does not have a valid IP yet"
        echo "please wait for an IP address to be assigned or recheck your mac"
        exit 1
    fi

else
    echo "Error: Invalid type, must either be -i (ip address) or -m (mac address)"
    exit 1
fi

ipmitool -I lanplus -U admin -P admin -H $IP sol deactivate
clear
ipmitool -I lanplus -U admin -P admin -H $IP sol activate