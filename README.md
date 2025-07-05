
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

---

# `check_station.sh`

This script checks the current status of a specified station.

The status can be one of the following:
1. No TMUX session is running on the station.
2. A TMUX session is running, but no L10 test is in progress.
3. An L10 test is currently running on the station.

## Usage

```bash
./check_station.sh <station_number>
```

---

# `clear_dhcp.sh`

This script clears all DHCP leases on the DHCP server running on the L10 server.  
**Note:** This script must be run as `root`.

This is useful if systems are receiving incorrect or inconsistent IP addresses.

## Usage

```bash
sudo ./clear_dhcp.sh
```

---

# `clear_known_hosts.sh`

This script clears all **known SSH hosts** entries on the server.

This is useful when the DHCP server reassigns IP addresses to different systems, which can cause a  
**"Host Key Verification Failed"** error when attempting to SSH.

## Usage

```bash
./clear_known_hosts.sh
```


