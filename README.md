
# Getting Started

## 1. Install Tailscale

Tailscale is the VPN we use to remotely connect to the different L10 servers in various locations.

To install Tailscale, visit:  
👉 [https://tailscale.com/download](https://tailscale.com/download)

Once installed, contact **giovanni_leon@wistron.com** to request login credentials.

---

## 2. Know Your Location

Once Tailscale is installed and the *Wistron L10 Labs VPN* is active, you can reach each lab by visiting:  
```
[location].wistronlabs.com
```

### Current locations:
- `tss` — TSS in Georgetown, TX
- `frk` — Dell in Franklin, MA

---

## 3. Access Your Location

You can access your location in one of two ways:

### Web Portal

Each location provides a web page where you can:
- View the current status of test stations.
- Download logs from previously completed tests.

Access the web portal via:  
```
http://[location].wistronlabs.com
```

#### Station Statuses
![Stations Screenshot](https://github.com/giovannirleon/wistronlabs/blob/main/media/station_statuses.png)

- **RED** — No activity on the station for the day.
- **GREEN** — Activity detected, but no L10 test currently running.
- **YELLOW** — An L10 test is currently running on the station.

#### Logs
![Logs Screenshot](https://github.com/giovannirleon/wistronlabs/blob/main/media/logs.png)

Clicking on a service tag in the logs section provides:
- `output.log` — A copy of the on-screen output from the L10 test.
- `LOG-[DATE]-[Time].tgz` — The compressed log files generated after the L10 test completes.

---

### Terminal

Running and managing L10 tests is primarily done through the terminal.  
You can use any terminal client you prefer, such as:
- **MobaXterm**
- **TeraTerm**
- Built-in terminal

To access the L10 server terminal, SSH into it:
```bash
ssh falab@[location].wistronlabs.com
```

For the SSH password, please contact **giovanni_leon@wistron.com**.

---

# `bios_serial.sh`

This script opens the system BIOS or serial console using the BMC. It is useful for troubleshooting boot issues and monitoring host power-on behavior.

## Usage

```bash
./bios_serial.sh <-i IP_ADDRESS | -m MAC_ADDRESS | -t SERVICE_TAG>
```

## Required Options (choose one)

- `-i IP_ADDRESS` — Specify the BMC by its **IP address**.
- `-m MAC_ADDRESS` — Specify the BMC by its **MAC address**.
- `-t SERVICE_TAG` — Specify the system by **service tag** and pull the BMC MAC from backend.

---

# `boot.sh`

This script prepares PXE boot configuration, waits for BMC and host readiness, and boots a unit into the Wistron PXE OS.

## Usage

```bash
./boot.sh [options]
```

## Common Options

- `-m, --manual` — Enter BMC MAC, host MAC, and config manually.
- `-t, --tag [SERVICE_TAG]` — Pull BMC MAC, host MAC, and config from backend. If omitted, you will be prompted for the service tag.
- `-b, --bmc-mac BMC_MAC` — Manual BMC MAC input.
- `-s, --sys-mac SYS_MAC` — Manual host MAC input.
- `-c CONFIG` — Manual config value when booting by MAC.
- `-l, --live` — Split the current station tmux pane and show BIOS serial on the right.

## Notes

- Must be run from a valid station tmux session such as `stn_<n>`.
- In backend mode, with no input flags, the script boots the system assigned to the active station in backend.
- If the active station has no assigned system, it prompts for a service tag; if that tag is not found, it prompts for BMC MAC, host MAC, and config and reminds the operator to receive the unit into tracking.
- Use `-m` for the interactive manual flow, or provide `-b`, `-s`, and `-c` for fully specified manual input.
- `-t` explicitly boots a system by service tag, regardless of the station assignment.
- If only one of `-b` or `-s` is given, the other will be prompted.

---

# `check_station.sh`

This script checks the current status of a specified station.

The status can be one of the following:
1. No TMUX session is running on the station.
2. A TMUX session is running, but no L10 test is in progress.
3. An L10 test is currently running on the station.

## Usage

```bash
./check_station.sh <station_name>
```

---

# `clear_dhcp.sh`

This script clears DHCP leases and restarts the DHCP service.

## Usage

```bash
sudo ./clear_dhcp.sh
```

---

# `clear_known_hosts.sh`

This script clears the local SSH `known_hosts` file.

## Usage

```bash
./clear_known_hosts.sh
```

---

# `get_ip.sh`

This script retrieves the current IP address assigned to a given MAC address, if a lease exists.

## Usage

```bash
./get_ip.sh [MAC_ADDRESS]
```

---

# `join_station.sh`

This script attaches to a specified station’s TMUX session by its number.  
If a TMUX session for the station does not already exist, the script creates one.

This session appears as a green bar at the bottom of your terminal, labeled with `[stn_#]` on the left.

### Tips
- To detach from the station session: press `CTRL+B D`
- To enter *copy mode* (to scroll through history and copy text): press `CTRL+B [`

## Usage

```bash
./join_station.sh <station_number>
./join_station.sh -l
```

---

# `ipmi.sh`

This is the main user-facing IPMI wrapper. It resolves a BMC from service tag, IP, or MAC input, then runs either a raw `ipmitool` command or a supported shortcut code.

## Usage

```bash
./ipmi.sh [target flags] [modifier flags] [ipmi arguments...]
./ipmi.sh [target flags] [modifier flags] -n CODE [ARG]
./ipmi.sh [target flags] [modifier flags] [SHORTCUT_FLAG] [ARG]
```

## Target Flags

- `-t SERVICE_TAG` — Resolve target from service tag.
- `-i BMC_IP` — Resolve target from BMC IP.
- `-m BMC_MAC` — Resolve target from BMC MAC.

## Modifier Flags

- `-c CONFIG` — Set the system config used to choose IPMI credentials.
- `-n CODE` — Use a numbered legacy shortcut command.
- `-l` — List enabled shortcut codes and flags.
- `-h` — Show help.

## Examples

```bash
./ipmi.sh -t TESTYB4 chassis power on
./ipmi.sh -i 192.168.1.50 -c F chassis power status
./ipmi.sh -m aabbccddeeff -c 7 --fru-print
./ipmi.sh -l
```

---

# `ipmitool.sh`

This is the older legacy IPMI utility script. It is still present for compatibility, but `ipmi.sh` is the preferred user-facing command for current workflows.

## Usage

```bash
bash ipmitool.sh [BMC_IP/RACK_ID] [CMD]
```

---

# `l10_test.sh`

This script runs the L10 diagnostic workflow for the system currently assigned to the active station in backend.

Before running, ensure the system is properly set up:
- Power connected
- Coolant connected
- Ethernet connected

Must be run inside a valid station tmux session. To join one, use [`join_station.sh`](#join_stationsh).

## Usage

```bash
./l10_test.sh [options]
```

### Options

- `-m, --manual` — Skip backend MAC pull and prompt for any missing MACs.
- `-b, --bmc-mac BMC_MAC` — Manual mode only: provide BMC MAC.
- `-s, --sys-mac SYS_MAC` — Manual mode only: provide host MAC.
- `-l, --live` — Show BIOS serial in the right pane until SSH is fully up.
- `-o, --options` — Open the interactive module picker.
- `-f, --fru-only` — Skip diag upload and L10 validation run.
- `-p, --power-on` — Keep the unit powered on after the script ends.

## Notes

- The script always uses the service tag and config assigned to the current station in backend.
- Without `-m`, BMC and host MACs are pulled from backend when available.
- With `-m`, you can provide `-b` and/or `-s`, and the script prompts for any missing MAC.

---

# `restart_station.sh`

If a TMUX station becomes unresponsive, you can detach from the station using `CTRL+B D`, then run this script to restart it.  

**Note:** Any programs currently running on that station will be terminated when it is restarted.

## Usage

```bash
./restart_station.sh <session_number>
./restart_station.sh -l
```

---

# `restart_pxe_services.sh`

This script restarts the PXE-related services.

## Usage

```bash
sudo ./restart_pxe_services.sh
```

---

# `station_status_json_gen.sh`

This script collects JSON status from each station and PATCHes the latest state back to backend.

## Usage

```bash
./station_status_json_gen.sh
```
