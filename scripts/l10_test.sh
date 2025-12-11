#!/bin/bash

RED='\033[0;31m'
NC='\033[0m' # No Color

err() {
    echo -e "${RED}Error:${NC} $*" >&2
}


# Check if SERVER_LOCATION environment variable is set
if [[ -z "${SERVER_LOCATION:-}" ]]; then
  err "Environment variable SERVER_LOCATION is not set." >&2
  echo "       Please export SERVER_LOCATION in your shell (e.g. in ~/.bashrc)." >&2
  exit 1
fi

# Check if SERVER_LOCATION environment variable is set
if [[ -z "${INTERNAL_API_KEY:-}" ]]; then
  echo "Error: environment variable INTERNAL_API_KEY is not set." >&2
  echo "       Please export INTERNAL_API_KEY in your shell (e.g. in ~/.bashrc)." >&2
  exit 1
fi

# Fetch station names
# Require jq
if ! command -v jq >/dev/null 2>&1; then
  err "jq is required but not installed." >&2
  exit 1
fi

# Get JSON from API
if ! json=$(curl -fsS --max-time 5 "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations"); then
  err "Unable to reach backend" >&2
  exit 1
fi

# Parse station_name into a bash array
mapfile -t STATIONS < <(printf '%s\n' "$json" | jq -r '.[].station_name')

# Sanity check
if ((${#STATIONS[@]} == 0)); then
  err "No stations found in API response." >&2
  exit 1
fi

# convert to tmux stations names (stn_<number>)
STATION_NAMES=()
for num in "${STATIONS[@]}"; do
    STATION_NAMES+=("stn_${num}")
done

if [[ -z "$TMUX" ]]; then
  err "This script must be run inside a tmux session" >&2
  echo "Run './join_station <#>' and try again"
  exit 1
fi


SESSION_NAME=$(tmux display-message -p '#S')
SESSION_NAME_PREFIX=$(echo "$SESSION_NAME" | cut -d_ -f1)
SESSION_NUMBER=$(echo "$SESSION_NAME" | cut -d_ -f2)

found=0
for name in "${STATION_NAMES[@]}"; do
    if [[ "$SESSION_NAME" == "$name" ]]; then
        found=1
        break
    fi
done

if [[ $found -eq 0 ]]; then
    err "You’re attempting to run L10 from a non-station tmux session. Please use ./join_station to join a valid station session first."
    exit 1
fi

# First: check if endpoint is reachable and returns 200
http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations/$SESSION_NUMBER")

if [[ "$http_code" != "200" ]]; then
    err "Backend API returned HTTP $http_code for station $SESSION_NUMBER"
    exit 1
fi 

# Second: fetch the body and extract system_service_tag
CURRENT_REMOTE_SERVICE_TAG=$(curl -s \
    "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations/$SESSION_NUMBER" | jq -r '.system_service_tag')


read -p "Enter BMC MAC address (e.g., 001A2B3C4D5E): " BMC_MAC
read -p "Enter HOST MAC address (e.g., 001A2B3C4D5E): " HOST_MAC
read -p "Enter Service Tag (e.g., A1B264): " SERVICE_TAG

if [[ "$CURRENT_REMOTE_SERVICE_TAG" == "null" ]]; then
    err “This system has not been assigned to ‘L10’ on Station $SESSION_NUMBER in the tracking website. Please update its status and re-run this command.”
    exit 1
fi

if [[ "$CURRENT_REMOTE_SERVICE_TAG" != "$SERVICE_TAG" ]]; then
    echo ""
    err "Station $SESSION_NUMBER currently has a system ($CURRENT_REMOTE_SERVICE_TAG) assigned that does not match this system's service tag ($SERVICE_TAG)."
    echo ""
    echo "Please either:"
    echo "  1. Mark $CURRENT_REMOTE_SERVICE_TAG as 'Sent to L11' or 'RMA - [TYPE]' on the tracking website."
    echo "  2. Move $CURRENT_REMOTE_SERVICE_TAG back to 'In Debug - Wistron'."
    exit 1
fi


while true; do
    read -p "Enter Config Number (e.g., 1): " CONFIG    
    if [[ "$CONFIG" =~ ^-?[0-9]+$ ]]; then
        echo "Running L10 with config $CONFIG"
        break
    else
        echo "Not a valid number. Try again."
    fi
done

# list of all possible test modules
MASTER_MODULE_LIST=(
    "Inventory"
    "CxPcieProperties"
    "BfPcieProperties"
    "BfMgmtPcieProperties"
    "TegraCpu"
    "TegraMemory"
    "CpuMemorySweep"
    "TegraClink"
    "Gpustress"
    "Gpumem"
    "Pcie"
    "Connectivity"
    "ThermalSteadyState"
    "IbStressCables"
    "Bf3PcieInterfaceTraffic"
    "CxeyegradeStart"
    "IbStressBf3PhyLoopback"
    "IbStressBf3Loopout"
    "IbStressCx7PhyLoopback"
    "IbStressLoopout400G_8X"
    "IbStressLoopout400G_4X"
    "CxeyegradeStop"
    "Ssd"
    "C2C"
    "DimmStress"
    "WisSsdPcieProperties"
    "NvlBwStress"
    "NvlBwStressBg610"
    "CpuGpuSyncPulsePower3Hz50duty"
    "CpuGpuSyncPulsePower10Hz50duty"
    "CpuGpuSyncPulsePower100Hz50duty"
    "CpuGpuSyncPulsePower500Hz50duty"
    "CpuGpuSyncPulsePower1kHz50duty"
    "CpuGpuSyncPulsePower2kHz50duty"
    "CpuGpuSyncPulsePower4KHz50duty"
    "CpuGpuSyncPulsePower5KHz50duty"
    "IbConfigureCx7Cables400G_8X"
    "IbConfigureCx7Cables400G_4X"
    "Cx8GpuDirectLoopback"
    "Cx8GpuDirectCrossGpu"
)
# defines the base modules that need to be skipped over for each configuration. 
# note that these might change as we get more testing equiptment
case "$CONFIG" in
    2)
        SKIPPED_MODULES=(
            "IbStressCables"
            "Bf3PcieInterfaceTraffic"
            "CxeyegradeStart"
            "IbStressBf3PhyLoopback"
            "IbStressBf3Loopout"
            "IbStressCx7PhyLoopback"
            "IbStressLoopout400G_8X"
            "IbStressLoopout400G_4X"
            "CxeyegradeStop"
        )
        ;;
    4)
        SKIPPED_MODULES=(
            "IbStressCables"
            "Bf3PcieInterfaceTraffic"
            "CxeyegradeStart"
            "IbStressBf3PhyLoopback"
            "IbStressBf3Loopout"
            "IbStressCx7PhyLoopback"
            "IbStressLoopout400G_8X"
            "IbStressLoopout400G_4X"
            "CxeyegradeStop"
            "WisSsdPcieProperties_E1S"
        )
        ;;
    6)
        SKIPPED_MODULES=(
            "IbStressBf3Loopout"
            #IbStressBf3PhyLoopback
            "IbStressCx7PhyLoopback"
            "IbStressLoopout400G_8X"
            "IbStressLoopout400G_4X"
            "IbStressCables"
            "Cx8GpuDirectLoopback"
            "Cx8GpuDirectCrossGpu"
            "Bf3PcieInterfaceTraffic"
            #"CxeyegradeStop"
        )
        ;;
    *)
        echo "Configuration $CONFIG is not valid on this server"
        exit 1
        ;;
esac

echo ""

# set the "CONFIG_LIST", or the list of modules that run by default on each config. 
# CONFIG_LIST = MASTER_MODULE_LIST - SKIPPED_MODULES (for a given config)
CONFIG_LIST=()
for mod in "${MASTER_MODULE_LIST[@]}"; do
    skip=0
    for skipmod in "${SKIPPED_MODULES[@]}"; do
        if [[ "$mod" == "$skipmod" ]]; then
            skip=1
            break
        fi
    done
    [[ $skip -eq 0 ]] && CONFIG_LIST+=("$mod")
done

# if the -o (option) flaag is set, it will set up an interactive prompt where you can pick the module(s) you would like to test
if [[ "$1" == "-o" ]]; then

    while true; do
        selected=$(printf "%s\n" "${CONFIG_LIST[@]}" | fzf --multi \
        --prompt="Select options: " \
        --bind "tab:toggle" \
        --header="Below are the options for config '"$CONFIG"' TAB to toggle, ENTER to confirm")
        if [[ -z "$selected" ]]; then
            echo "Error - you must pick at least ONE module to run"
        else
            echo "INFO - Only running:"
            echo "$selected"
            break
        fi
    done

    # Get unselected options
    ADDED_SKIPPED_MODULES=$(comm -23 \
        <(printf "%s\n" "${CONFIG_LIST[@]}" | sort) \
        <(printf "%s\n" "$selected" | sort))

    #creates the formatted added modules string (one liner, comma separated, comma a beginning, no comma a beginning if empty)
    ADDED_SKIPPED_MODULES_FORMATTED=$( [ -n "$ADDED_SKIPPED_MODULES" ] && printf ",%s" $(printf "%s\n" $ADDED_SKIPPED_MODULES | paste -sd, -) )
else
    ADDED_SKIPPED_MODULES_FORMATTED=""
fi

#creates the formatted added modules string (one liner, comma separated)
SKIPPED_MODULES_FORMATTED=$(IFS=,; echo "${SKIPPED_MODULES[*]}")

BMC_MAC=$(echo "$BMC_MAC" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')
HOST_MAC=$(echo "$HOST_MAC" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')

echo ""
clear

# --- set up logging ---
START_TS=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

LOG_DIR="/var/www/html/l10_logs/$SERVICE_TAG/${START_TS}/"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/run_${SERVICE_TAG}_${START_TS}.log"

# Save the original terminal FDs
exec 3>&1 4>&2

# Open a persistent tee on FD 5 (to file + terminal)
exec 5> >(tee -a "$LOG_FILE")

# Start by sending stdout/stderr through tee
exec 1>&5 2>&5

echo "==> Logging to $LOG_FILE"

# Helpers to toggle logging
log_off() {  exec 1>&3 2>&4; }   # to terminal only (no file)
log_on()  {  exec 1>&5 2>&5; }   # back through tee (file + terminal)

BMC_ASSIGNMENT_TIMEOUT=$((5 * 60)) #10 minutes timeout
BMC_ASSIGNMENT_START_TIME=$(date +%s)

while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED_TIME=$((CURRENT_TIME - BMC_ASSIGNMENT_START_TIME))

    if ((ELAPSED_TIME > BMC_ASSIGNMENT_TIMEOUT)); then
        err "It is taking too long to get a BMC IP, please check the system"
        echo "Possible issues: system is not on, hardware issue"
        exit 1
    fi

    BMC_IP=$(awk -v mac="$BMC_MAC" '
        /lease/ {ip=$2} 
        /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip} 
        found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -n "$BMC_IP" ]]; then
        echo "IP Address for BMC: $BMC_IP"
	break
    else
        printf "%02dh %02dm %02ds - Waiting for BMC IP assignment... \n" $((ELAPSED_TIME/3600)) $(( (ELAPSED_TIME%3600)/60 )) $((ELAPSED_TIME%60))
        sleep 5
    fi
done

echo ""

IPMI_PING_TIMEOUT=$((5 * 60)) #10 minutes timeout
IPMI_PING_START_TIME=$(date +%s)

while ! ipmitool -I lanplus -H $BMC_IP -U admin -P admin chassis power 2>/dev/null; do
    
    CURRENT_TIME=$(date +%s)
    ELAPSED_TIME=$((CURRENT_TIME - IPMI_PING_START_TIME))

    if ((ELAPSED_TIME > IPMI_PING_TIMEOUT)); then
        err "It is taking too long to get a IPMI response"
        echo "This is most likey a BMC hardware issue"
        exit 1
    fi

    echo ""
    printf "%02dh %02dm %02ds - Waiting for valid IPMI response...... \n" $((ELAPSED_TIME/3600)) $(( (ELAPSED_TIME%3600)/60 )) $((ELAPSED_TIME%60))

    sleep 5
done

echo "INFO - IPMI response received!"
echo ""

echo "INFO - Getting system PPID"
SYSTEM_PPID=$(ipmitool -I lanplus -U admin -P admin -H $BMC_IP fru print 0 | grep "Product Serial" | cut -d':' -f2 | xargs)

# Exit if empty
if [[ -z "$SYSTEM_PPID" ]]; then
  echo "ERROR: Could not get PPID, something might be wrong with the FRU data"
  exit 1
fi

echo "Info - PPID is $SYSTEM_PPID"

# Send PPID to tracking API and capture response
response=$(curl -sS -X PATCH "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/systems/$SERVICE_TAG/ppid" \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"ppid\": \"$SYSTEM_PPID\"}")

# Extract fields
msg=$(echo "$response" | jq -r '.message // empty')
err_msg=$(echo "$response" | jq -r '.error // empty')

# Output accordingly
if [[ -n "$err_msg" ]]; then
    err "Cannot update PPID, $err_msg" 
    echo ""
    exit 1
elif [[ -n "$msg" ]]; then
    echo "INFO - $msg"
    echo ""
else
    echo "Unexpected response: $response"
    echo ""
fi



echo "INFO - Changing Boot Device to PXE"
ipmitool -I lanplus -H $BMC_IP -U admin -P admin chassis bootdev pxe

echo ""

echo "INFO - Powering on system"
ipmitool -I lanplus -H $BMC_IP -U admin -P admin chassis power on

echo ""

HOST_ASSIGNMENT_TIMEOUT=$((10 * 60)) #10 minute timeout
HOST_ASSIGNMENT_START_TIME=$(date +%s)

while true; do

    CURRENT_TIME=$(date +%s)
    ELAPSED_TIME=$((CURRENT_TIME - HOST_ASSIGNMENT_START_TIME))

    if ((ELAPSED_TIME > HOST_ASSIGNMENT_TIMEOUT)); then
        err "It is taking too long to get a HOST IP, please check if the host is on"
        echo "Recommended Action:"
        echo "  - Re-run this l10_test.sh while monitoring the system via BIOS serial to confirm the system is booting correctly."
        echo "  - You can monitor the BIOS serial output using:"
        echo "      ./bios_serial <-i IP_ADDRESS | -m MAC_ADDRESS>" 
        echo ""
        exit 1
    fi

    HOST_IP=$(awk -v mac="$HOST_MAC" '
        /lease/ {ip=$2} 
        /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip}
        found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -n "$HOST_IP" ]]; then
        echo "IP Address for HOST: $HOST_IP"
        break
    else
        printf "%02dh %02dm %02ds - Waiting for Host IP assignment... \n" $((ELAPSED_TIME/3600)) $(( (ELAPSED_TIME%3600)/60 )) $((ELAPSED_TIME%60))

        sleep 5
    fi
done

echo ""

SSH_PING_TIMEOUT=$((15 * 60)) #15 minute timeout
SSH_PING_START_TIME=$(date +%s)

while ! nc -z $HOST_IP 22; do

    CURRENT_TIME=$(date +%s)
    ELAPSED_TIME=$((CURRENT_TIME - SSH_PING_START_TIME))

    if ((ELAPSED_TIME > SSH_PING_TIMEOUT)); then
        err "It is taking too long to ping the ssh service on the host"
        echo "Make sure the system is on AND is booted to the correct image (Wistron L10 Image)"
        echo "Recommended Action:"
        echo "  - Re-run this l10_test.sh while monitoring the system via BIOS serial to confirm the system is booting correctly."
        echo "  - You can monitor the BIOS serial output using:"
        echo "      ./bios_serial <-i IP_ADDRESS | -m MAC_ADDRESS>" 
        echo ""
        exit 1
    fi

    printf "%02dh %02dm %02ds - Waiting for SSH service up on HOST %s... \n" $((ELAPSED_TIME/3600)) $(( (ELAPSED_TIME%3600)/60 )) $((ELAPSED_TIME%60)) "$HOST_IP"    
    sleep 5
done

echo ""
echo "INFO - Adding SSH host to known_hosts file"
ssh-keyscan -H $HOST_IP >> ~/.ssh/known_hosts #&>/dev/null
echo ""

# check if the authentication key works when SSHing into the Gaines system
# if it does not work, its 99% not in the right OS (like the stock Ubuntu OS that it comes with)
if ! ssh -o BatchMode=yes -o ConnectTimeout=5 nvidia@"$HOST_IP" "exit" 2>/dev/null; then
    err "SSH key authentication to nvidia@$HOST_IP failed."
    echo "Possible Cause: The target system is not running the Wistron L10 PXE OS."
    echo "Recommended Action:"
    echo "  - Re-run this l10_test.sh while monitoring the system via BIOS serial to confirm the correct OS is loaded."
    echo "  - You can monitor the BIOS serial output using:"
    echo "      ./bios_serial <-i IP_ADDRESS | -m MAC_ADDRESS>" 
    echo ""
    echo "INFO - Changing Boot Device to PXE"
    ipmitool -I lanplus -H $BMC_IP -U admin -P admin chassis bootdev pxe
    echo ""
    echo "Powering off system"
    ipmitool -I lanplus -U admin -P admin -H "$BMC_IP" chassis power off
    exit 1
fi

log_off
# Runs the L10 validation test by SSHing into the remote system and attaching to a tmux session.
# Executes the partnerdiag script with the correct config file and the specified skipped modules.
# Logs are saved to output.log via `tee`.
# Then:
#   - Adds the falab server to known_hosts (if not already added)
#   - Identifies the latest logs archive (logs-*.tgz)
#   - Copies both the latest log archive and output.log back to the falab server
echo "Running config $CONFIG L10 Validation Tests"
ssh -t nvidia@"$HOST_IP" 'tmux new-session -As '"$SERVICE_TAG"' "
    sleep 1
    cd /home/nvidia/l10_diag_r8_386/
    sudo ./partnerdiag --mfg \
        --run_spec=spec_gb200_nvl_2_4_board_pc_partner_mfg_gaines1_5_ps_config'"$CONFIG"'.json \
        --run_on_error --no_bmc \
        --skip_tests='"$SKIPPED_MODULES_FORMATTED$ADDED_SKIPPED_MODULES_FORMATTED"' \
        2>&1 | tee /home/nvidia/output.log
    ssh-keyscan -H '"$SERVER_LOCATION"'.wistronlabs.com >> ~/.ssh/known_hosts
    sleep 2
    cd logs
    LATEST=\$(ls -1 logs-*.tgz | sort | tail -n1)
    ssh falab@'"$SERVER_LOCATION"'.wistronlabs.com mkdir -p '"$LOG_DIR"'
    scp -r /home/nvidia/l10_diag_r8_386/logs/\$LATEST falab@'"$SERVER_LOCATION"'.wistronlabs.com:'"$LOG_DIR"'/\$LATEST
    scp /home/nvidia/output.log falab@'"$SERVER_LOCATION"'.wistronlabs.com:'"$LOG_DIR"'/diag_output.log
    sleep 8
"'

sleep 1
log_on
echo "INFO - Powering off system"
ipmitool -I lanplus -H $BMC_IP -U admin -P admin chassis power off

echo ""
 
cat $LOG_DIR/diag_output.log
log_off
rm $LOG_DIR/diag_output.log
echo "logs are located at $LOG_DIR"
