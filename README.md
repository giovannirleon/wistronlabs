
# `bios_serial.sh`

This script connects to the system’s **BIOS serial console** using *Serial over LAN (SoL)* via the BMC, removing the need to physically connect to the BIOS serial USB port on the front of the system.  

Accessing the BIOS serial console is useful for advanced troubleshooting during host power-on.

## Usage

```bash
./bios_serial.sh <-i IP_ADDRESS | -m MAC_ADDRESS>
```

## Required Options (choose one)

- `-i IP_ADDRESS` — Specify the BMC by its **IP address**.
- `-m MAC_ADDRESS` — Specify the BMC by its **MAC address**.

---

# `chassis_power.sh`

This script remotely controls the host system’s power state or checks its current power status.

## Usage

```bash
./chassis_power.sh <on|off|status> <-i IP_ADDRESS | -m MAC_ADDRESS>
```

## Commands
- `on` — Power on the system.
- `off` — Power off the system.
- `status` — Display the system’s current power status.
  
## Required Options (choose one)

- `-i IP_ADDRESS` — Specify the BMC by its **IP address**.
- `-m MAC_ADDRESS` — Specify the BMC by its **MAC address**.


