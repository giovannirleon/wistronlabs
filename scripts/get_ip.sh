#!/bin/bash

if [ -z $1 ]; then 
        read -p "Enter MAC address (e.g., 001A2B3C4D5E): " BMC_MAC
else
        BMC_MAC=$1
fi


# Convert to lowercase (since dhcpd.leases uses lowercase MACs)
BMC_MAC=$(echo "$BMC_MAC" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')
awk -v mac="$BMC_MAC" '
	/lease/ {ip=$2} 
        /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip} 
        found && /}/ {print ip; found=0}
	' /var/lib/dhcp/dhcpd.leases | tail -n 1
