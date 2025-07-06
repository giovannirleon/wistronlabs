#!/bin/bash

# Check for root
if [ "$EUID" -ne 0 ]; then
  echo "❌ This script must be run as root. Use sudo:"
  echo "   sudo $0 $@"
  exit 1
fi

systemctl restart tftpd-hpa
systemctl restart isc-dhcp-server
systemctl restart apache2

systemctl status  tftpd-hpa --no-pager
echo ""
systemctl status  isc-dhcp-server --no-pager
echo ""
systemctl status  apache2 --no-pager
