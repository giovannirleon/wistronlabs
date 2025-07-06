#!/bin/bash

# Check if exactly three arguments are provided
if [ $# -ne 3 ]; then
    echo "Usage: ./chassis_power.sh <on|off|status> <-i IP_ADDRESS | -m MAC_ADDRESS>"
    echo ""
    echo "Commands:"
    echo "on        Power on the system"
    echo "off       Power off the system"
    echo "status    Show current power status"
    echo ""
    echo "Required Options (one of):"
    echo "-i IP     Specify BMC by IP address"
    echo "-m MAC    Specify BMC by MAC address"
    exit 1
fi

ACTION="$1"
ADDRESS_TYPE="$2"
ADDRESS_VALUE="$3"


# Simple validation for IP address format
if [[ "$ADDRESS_TYPE" = "-i" ]]; then
   
    if ! [[ "$ADDRESS_VALUE" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
        echo "Error: Invalid IP address format."
        echo "Needs to be in 123.456.789.012 format"
        exit 1
    fi  

    IP=$ADDRESS_VALUE

elif [[ "$ADDRESS_TYPE" = "-m" ]]; then

    #check MAC address format
    if ! [[ "$ADDRESS_VALUE" =~ ^[A-Fa-f0-9]{12}$ ]]; then
        echo "Error: Invalid MAC address format."
        echo "Needs to be in 001A2B3C4D5E format"
        exit 1
    fi

    # convert the mac address from 001A2B3C4D5E to 00:1a:2b:3c:4d:5e (format used in /var/lib/dhcp/dhcpd.leases file)
    ADDRESS_VALUE=$(echo "$ADDRESS_VALUE" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')

    # get the IP address (if it exists) from the leases file
    IP=$(awk -v mac="$ADDRESS_VALUE" '
        /lease/ {ip=$2} 
        /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip} 
        found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    # return error code if IP address does not exist for that MAC address
    if [[ -z "$IP" ]]; then
        echo "Error: The MAC Address given does not have a valid IP yet"
        echo "please wait for an IP address to be assigned or recheck your mac"
        exit 1
    fi

# error out if the second arguement is not -m or -i (malformed command or bad flag)
else
    echo "Error: Invalid type, must either be -i (ip address) or -m (mac address)"
    exit 1
fi


# Handle "on", "off", and "status" (as all other) commands
case "$ACTION" in
    on)
        ipmitool -I lanplus -U admin -P admin -H "$IP" chassis power on
        ;;
    off)
        ipmitool -I lanplus -U admin -P admin -H "$IP" chassis power off
        ;;
    *)
        ipmitool -I lanplus -U admin -P admin -H "$IP" chassis power status
        ;;
esac