#!/bin/bash

# Check for root
if [ "$EUID" -ne 0 ]; then
  echo "❌ This script must be run as root. Use sudo:"
  echo "   sudo $0 $@"
  exit 1
fi

systemctl stop isc-dhcp-server
rm /var/lib/dhcp/dhcpd.leases
touch /var/lib/dhcp/dhcpd.leases
systemctl start isc-dhcp-server

systemctl status isc-dhcp-server --no-pager