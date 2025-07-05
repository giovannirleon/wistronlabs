
# `bios_serial.sh`

This script connects to the system’s **BIOS serial console** using *Serial over LAN (SoL)* via the BMC, removing the need to physically connect to the BIOS serial USB port on the front of the system.  

Accessing the BIOS serial console is useful for advanced troubleshooting during host power-on.

## Usage

```bash
./bios_serial.sh <-i IP_ADDRESS | -m MAC_ADDRESS>
```

## Options

- `-i` — Specify the BMC by its **IP address**.
- `-m` — Specify the BMC by its **MAC address**.
