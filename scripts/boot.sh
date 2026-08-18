#!/bin/bash
# About:
#   Prepares PXE boot configuration, waits for BMC and host readiness, and
#   boots a unit into the Wistron PXE OS.
#   In backend mode, the default pulls the unit assigned to the current station.
#   Field mode uses local stations plus a single default config from
#   FIELD_DEFAULT_CONFIG or scripts/config/field_stations.json.
#
# Usage:
#   WISTRON_MODE=backend ./boot.sh [options]
#   WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./boot.sh [options]
#   Must be run inside a valid station tmux session in both modes.
#

set -euo pipefail


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/err.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/runtime_mode.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_cmd.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/mac_colon.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/normalize_mac_hex12.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/prompt_service_tag.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_server_location.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/pick_config_from_backend.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/fetch_system_from_backend.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/fetch_station_list.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/ipmi.sh"

LIVE_MODE=0
LIVE_CHILD=0
LIVE_BIOS_CHILD=0
TAG_MODE=0
MANUAL_MODE=0
SERVICE_TAG=""
BMC_MAC="${BMC_MAC:-}"
HOST_MAC="${HOST_MAC:-}"
CONFIG="${CONFIG:-}"
STATION_SESSION_NAME=""
STATION_SESSION_NUMBER=""
LIVE_RIGHT_PANE_ID=""
LIVE_CHILD_PID=""
LIVE_WAIT_INTERRUPTED=0

print_help() {
  if is_field_mode; then
    cat <<EOF
Usage:
  ./boot.sh [options]
  Must be run inside a valid station tmux session.

Options:
  -m, --manual
      Enter BMC MAC, system MAC, and config manually.
  -b, --bmc-mac BMC_MAC
      The BMC MAC used when booting via MAC address.
  -s, --sys-mac SYS_MAC
      The System MAC used when booting via MAC address.
  -c CONFIG
      Config of the unit. Field mode only supports ${FIELD_DEFAULT_CONFIG:-the configured default}.
  -l, --live
      Split the current station tmux pane and show BIOS serial on the right.
  -h, --help
      Show this help and exit.

Field mode behavior:
  - Uses local station definitions from FIELD_STATIONS_FILE.
  - Uses FIELD_DEFAULT_CONFIG or the field stations JSON default_config.
  - Manual MAC input only. Tag lookup is disabled.

Examples:
  WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./boot.sh
  WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./boot.sh -l
  WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./boot.sh -b 001a2b3c4d5e -s 00aa11bb22cc
EOF
  else
    cat <<'EOF'
Usage:
  ./boot.sh [options]
  Must be run inside a valid station tmux session.

Options:
  -m, --manual
      Enter BMC MAC, system MAC, and config manually.
  -t, --tag [SERVICE_TAG]
      Pull BMC MAC, Host MAC, and config from backend.
      If SERVICE_TAG is omitted, you will be prompted for it.
  -b, --bmc-mac BMC_MAC
      The BMC MAC used when booting via MAC address.
  -s, --sys-mac SYS_MAC
      The System MAC used when booting via MAC address.
  -c CONFIG
      Config of the unit, needed when booting via MAC address.
  -l, --live
      Split the current station tmux pane and show BIOS serial on the right.
  -h, --help
      Show this help and exit.

What it does:
  - With no input flags, pulls the system assigned to the active station.
  - Can instead pull a system by service tag or accept manual inputs.
  - Writes the matching PXE grub config.
  - Waits for BMC, host IP, and SSH readiness.
  - Boots the unit into the Wistron PXE OS.
  - SSHes into the host when ready.

Mode rules:
  - With no input flags, the active station must have a system assigned in backend.
  - -m/--manual (or -b, -s, or -c) uses manual-input mode.
  - -t/--tag cannot be used with manual options.

Live mode:
  Keeps the current station pane on the left, opens BIOS serial on the right,
  and switches to the bs_<BMC_MAC> session when boot completes successfully.

Examples:
  ./boot.sh
  ./boot.sh -l
  ./boot.sh -m
  ./boot.sh -l -m
  ./boot.sh -t ABC1234
  ./boot.sh -l -t ABC1234
  ./boot.sh -b 001a2b3c4d5e -s 00aa11bb22cc -c F
  ./boot.sh -b 001a2b3c4d5e -s 00aa11bb22cc
EOF
  fi
}

prompt_mac() {
  local label="$1"
  local value

  while true; do
    read -r -p "$label MAC: " value
    value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    if [[ "$value" =~ ^[0-9a-f]{12}$ ]]; then
      printf '%s\n' "$value"
      return 0
    fi
    err "Invalid MAC address. Enter exactly 12 hex characters with no separators."
  done
}

mac_dash() {
  printf '%s' "$1" | sed 's/\(..\)/\1-/g; s/-$//'
}

load_auto_inputs() {
  local sys_json

  if is_field_mode; then
    err "Tag mode is not available in field mode. Use manual MAC input."
    exit 1
  fi

  require_cmd curl
  require_cmd jq

  if [[ -z "$SERVICE_TAG" ]]; then
    SERVICE_TAG="$(prompt_service_tag)"
  else
    SERVICE_TAG="$(printf '%s' "$SERVICE_TAG" | tr '[:lower:]' '[:upper:]' | xargs)"
  fi

  require_server_location
  sys_json="$(fetch_system_from_backend "$SERVICE_TAG")"

  load_auto_inputs_from_json "$sys_json"
}

load_auto_inputs_from_json() {
  local sys_json="$1" bmc_raw host_raw config_raw

  bmc_raw="$(printf '%s' "$sys_json" | jq -r '.bmc_mac // empty')"
  host_raw="$(printf '%s' "$sys_json" | jq -r '.host_mac // empty')"
  config_raw="$(printf '%s' "$sys_json" | jq -r '.config // empty')"

  if ! BMC_MAC="$(normalize_mac_hex12 "$bmc_raw")"; then
    err "BMC MAC is missing or invalid for $SERVICE_TAG."
    exit 1
  fi

  if ! HOST_MAC="$(normalize_mac_hex12 "$host_raw")"; then
    err "Host MAC is missing or invalid for $SERVICE_TAG."
    exit 1
  fi

  if [[ -z "$config_raw" || "$config_raw" == "null" ]]; then
    err "System $SERVICE_TAG has no known config in tracking website."
    exit 1
  fi

  CONFIG="$config_raw"
  export SERVICE_TAG BMC_MAC HOST_MAC CONFIG

  echo
  echo "SERVICE_TAG=$SERVICE_TAG"
  echo "BMC_MAC=$BMC_MAC"
  echo "HOST_MAC=$HOST_MAC"
  echo "CONFIG=$CONFIG"
}

load_auto_inputs_if_found() {
  local api_base tmp_json http_code sys_json

  require_cmd curl
  require_cmd jq
  require_server_location

  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
  tmp_json="$(mktemp)"
  http_code="$(curl -sS --max-time 5 -o "$tmp_json" -w "%{http_code}" \
    "$api_base/systems/$SERVICE_TAG" 2>/dev/null || true)"

  if [[ "$http_code" == "404" ]]; then
    rm -f "$tmp_json"
    return 1
  fi
  if [[ "$http_code" != "200" ]]; then
    rm -f "$tmp_json"
    err "Backend returned HTTP $http_code when fetching $SERVICE_TAG."
    exit 1
  fi

  sys_json="$(<"$tmp_json")"
  rm -f "$tmp_json"
  load_auto_inputs_from_json "$sys_json"
}

load_station_inputs() {
  local api_base station_json station_tag

  if is_field_mode; then
    err "Backend station lookup is not available in field mode. Use -m/--manual."
    exit 1
  fi

  require_cmd curl
  require_cmd jq
  require_server_location

  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
  if ! station_json="$(curl -fsS --max-time 8 "$api_base/stations/$STATION_SESSION_NUMBER")"; then
    err "Unable to fetch assignment for station $STATION_SESSION_NUMBER."
    exit 1
  fi

  station_tag="$(printf '%s' "$station_json" | jq -r '.system_service_tag // empty')"
  SERVICE_TAG="$(printf '%s' "$station_tag" | tr '[:lower:]' '[:upper:]' | xargs)"
  if [[ -z "$SERVICE_TAG" ]]; then
    echo "No system is currently assigned to Station $STATION_SESSION_NUMBER in the tracking website."
    echo "Enter the unit's service tag to continue."
    SERVICE_TAG="$(prompt_service_tag)"

    if ! load_auto_inputs_if_found; then
      echo "Service tag $SERVICE_TAG was not found in the tracking website."
      echo "Enter the BMC MAC, host MAC, and config manually to continue."
      echo "WARNING - Receive this unit into the tracking website as soon as possible to avoid losing FA information."
      BMC_MAC=""
      HOST_MAC=""
      CONFIG=""
      MANUAL_MODE=1
      load_inputs 1
    fi
    return 0
  fi

  echo "Using system $SERVICE_TAG assigned to station $STATION_SESSION_NUMBER."
  load_auto_inputs
}

load_inputs() {
  local prompt_config="${1:-0}"
  local config_found api_base dpn_json

  if [[ -z "$BMC_MAC" ]]; then
    BMC_MAC="$(prompt_mac "BMC")"
  else
    if ! BMC_MAC="$(normalize_mac_hex12 "$BMC_MAC")"; then
      err "Invalid BMC MAC. Enter exactly 12 hex characters, with or without : or - separators."
      exit 1
    fi
  fi

  if [[ -z "$HOST_MAC" ]]; then
    HOST_MAC="$(prompt_mac "Host")"
  else
    if ! HOST_MAC="$(normalize_mac_hex12 "$HOST_MAC")"; then
      err "Invalid system MAC. Enter exactly 12 hex characters, with or without : or - separators."
      exit 1
    fi
  fi

  if [[ -z "$CONFIG" ]]; then
    if is_field_mode; then
      CONFIG="$(field_default_config)"
    elif [[ "$prompt_config" == "1" ]]; then
      while [[ -z "$CONFIG" ]]; do
        read -r -p "Config: " CONFIG
        CONFIG="$(printf '%s' "$CONFIG" | tr '[:lower:]' '[:upper:]' | xargs)"
        if [[ -z "$CONFIG" ]]; then
          err "Config cannot be empty."
        fi
      done
      # Re-enter the normal manual path so the entered config is validated
      # against the backend list before booting.
      load_inputs
      return 0
    else
      require_cmd fzf
      CONFIG="$(pick_config_from_backend)"
    fi
  else
    CONFIG="$(printf '%s' "$CONFIG" | tr '[:lower:]' '[:upper:]')"

    if is_field_mode; then
      if [[ "$CONFIG" != "$(field_default_config | tr '[:lower:]' '[:upper:]')" ]]; then
        err "Field mode only supports config $(field_default_config)."
        exit 1
      fi
    else
      require_cmd curl
      require_cmd jq
      require_server_location
      api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
      dpn_json="$(curl -fsS --max-time 10 "$api_base/systems/dpn")"
      config_found=0

      while IFS= read -r backend_config; do
        if [[ "$backend_config" == "$CONFIG" ]]; then
          config_found=1
          break
        fi
      done < <(
        printf '%s\n' "$dpn_json" |
          jq -r '.[].config // empty' |
          awk 'NF' |
          tr '[:lower:]' '[:upper:]' |
          sort -u
      )

      if [[ "$config_found" -eq 0 ]]; then
        err "Config $CONFIG is not present in the backend config list."
        exit 1
      fi
    fi
  fi

  if [[ -z "$CONFIG" ]]; then
    err "No config selected."
    exit 1
  fi

  export BMC_MAC HOST_MAC CONFIG

  echo
  echo "BMC_MAC=$BMC_MAC"
  echo "HOST_MAC=$HOST_MAC"
  echo "CONFIG=$CONFIG"
}

validate_child_inputs() {
  if [[ ! "${BMC_MAC:-}" =~ ^[0-9a-fA-F]{12}$ ]]; then
    err "BMC_MAC must be set to exactly 12 hex characters for live child mode."
    exit 1
  fi
  if [[ ! "${HOST_MAC:-}" =~ ^[0-9a-fA-F]{12}$ ]]; then
    err "HOST_MAC must be set to exactly 12 hex characters for live child mode."
    exit 1
  fi
  if [[ -z "${CONFIG:-}" ]]; then
    err "CONFIG must be set for live child mode."
    exit 1
  fi

  BMC_MAC="$(printf '%s' "$BMC_MAC" | tr '[:upper:]' '[:lower:]')"
  HOST_MAC="$(printf '%s' "$HOST_MAC" | tr '[:upper:]' '[:lower:]')"
  export BMC_MAC HOST_MAC CONFIG
}

require_station_tmux_session() {
  local found
  local -a station_names

  require_cmd tmux

  if [[ -z "${TMUX:-}" ]]; then
    err "This script must be run inside a station tmux session."
    echo "Run './join_station <#>' and try again"
    exit 1
  fi

  mapfile -t station_names < <(fetch_station_list)

  STATION_SESSION_NAME="$(tmux display-message -p '#S')"
  STATION_SESSION_NUMBER="${STATION_SESSION_NAME#stn_}"

  found=0
  for name in "${station_names[@]}"; do
    if [[ "$STATION_SESSION_NAME" == "$name" || "$STATION_SESSION_NUMBER" == "$name" || "stn_$name" == "$STATION_SESSION_NAME" ]]; then
      found=1
      break
    fi
  done

  if [[ "$found" -eq 0 ]]; then
    err "This script must be run from a valid station tmux session. Use ./join_station first."
    exit 1
  fi
}

report_live_status() {
  local boot_status="$1"
  local bios_session_name

  if [[ -n "$LIVE_RIGHT_PANE_ID" ]]; then
    tmux kill-pane -t "$LIVE_RIGHT_PANE_ID" 2>/dev/null || true
    LIVE_RIGHT_PANE_ID=""
  fi

  echo
  if [[ "$boot_status" -eq 0 ]]; then
    echo "Boot status: complete"
    bios_session_name="bs_${BMC_MAC}"
    if tmux has-session -t "$bios_session_name" 2>/dev/null; then
      tmux switch-client -t "$bios_session_name"
    else
      echo "INFO - No BIOS session found; staying in $STATION_SESSION_NAME."
    fi
  else
    echo "Boot status: incomplete"
  fi
}

close_live_right_pane() {
  if [[ -n "$LIVE_RIGHT_PANE_ID" ]]; then
    tmux kill-pane -t "$LIVE_RIGHT_PANE_ID" 2>/dev/null || true
    LIVE_RIGHT_PANE_ID=""
  fi
}

live_terminate_signal_trap() {
  local signal="$1"

  close_live_right_pane
  if [[ -n "$LIVE_CHILD_PID" ]]; then
    kill -s "$signal" "$LIVE_CHILD_PID" 2>/dev/null || true
  fi
  trap - INT TERM HUP QUIT TSTP
  kill -s "$signal" "$$"
}

live_tstp_signal_trap() {
  LIVE_WAIT_INTERRUPTED=1
  close_live_right_pane
  if [[ -n "$LIVE_CHILD_PID" ]]; then
    kill -s TSTP "$LIVE_CHILD_PID" 2>/dev/null || true
  fi
  trap - TSTP
  kill -s TSTP "$$"
  trap 'live_tstp_signal_trap' TSTP
}

start_live_tmux() {
  local script_dir current_pane_id window_target pane_count right_cmd boot_status status_file

  require_cmd tmux
  require_cmd ssh
  require_cmd ssh-keyscan

  require_station_tmux_session

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ ! -x "$script_dir/bios_serial.sh" ]]; then
    err "Expected executable BIOS serial script at $script_dir/bios_serial.sh"
    exit 1
  fi

  pane_count="$(tmux display-message -p '#{window_panes}')"
  if ((pane_count != 1)); then
    err "Live boot requires the current station window to have exactly one pane. Close extra panes and try again."
    exit 1
  fi

  current_pane_id="$(tmux display-message -p '#{pane_id}')"
  window_target="$(tmux display-message -p '#S:#I')"
  right_cmd="cd '$script_dir' && WISTRON_MODE='$WISTRON_MODE' FIELD_STATIONS_FILE='$FIELD_STATIONS_FILE' FIELD_DEFAULT_CONFIG='${FIELD_DEFAULT_CONFIG:-}' SERVER_LOCATION='${SERVER_LOCATION:-}' BMC_MAC='$BMC_MAC' ./boot.sh --live-bios-child"
  status_file="$(mktemp)"

  LIVE_RIGHT_PANE_ID="$(tmux split-window -h -P -F '#{pane_id}' -t "$current_pane_id" "$right_cmd")"
  tmux select-layout -t "$window_target" even-horizontal
  tmux select-pane -t "$current_pane_id"

  trap 'live_terminate_signal_trap INT' INT
  trap 'live_terminate_signal_trap TERM' TERM
  trap 'live_terminate_signal_trap HUP' HUP
  trap 'live_terminate_signal_trap QUIT' QUIT
  trap 'live_tstp_signal_trap' TSTP

  LIVE_WAIT_INTERRUPTED=0
  (
    trap 'printf "%s\n" "$?" > "$status_file"' EXIT
    trap - INT TERM HUP QUIT TSTP
    set +e
    LIVE_CHILD=1
    run_boot_flow
  ) &
  LIVE_CHILD_PID=$!

  while true; do
    if wait "$LIVE_CHILD_PID"; then
      boot_status=0
      break
    fi

    boot_status=$?
    if [[ "$LIVE_WAIT_INTERRUPTED" == "1" ]] && kill -0 "$LIVE_CHILD_PID" 2>/dev/null; then
      LIVE_WAIT_INTERRUPTED=0
      continue
    fi
    break
  done

  LIVE_CHILD_PID=""
  trap - INT TERM HUP QUIT TSTP
  if [[ -s "$status_file" ]]; then
    boot_status="$(<"$status_file")"
  fi
  rm -f "$status_file"
  report_live_status "$boot_status"
}

run_live_bios_child() {
  local script_dir

  if [[ ! "${BMC_MAC:-}" =~ ^[0-9a-fA-F]{12}$ ]]; then
    err "BMC_MAC must be set to exactly 12 hex characters for live BIOS child mode."
    exit 1
  fi

  BMC_MAC="$(printf '%s' "$BMC_MAC" | tr '[:upper:]' '[:lower:]')"
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  echo "==> Waiting for BMC IP before opening BIOS serial"
  wait_for_bmc_ip

  echo
  echo "==> Opening BIOS serial session for BMC $BMC_MAC"
  exec env -u TMUX WISTRON_MODE="$WISTRON_MODE" FIELD_STATIONS_FILE="$FIELD_STATIONS_FILE" FIELD_DEFAULT_CONFIG="${FIELD_DEFAULT_CONFIG:-}" SERVER_LOCATION="${SERVER_LOCATION:-}" "$script_dir/bios_serial.sh" -m "$BMC_MAC"
}

write_grub_config() {
  local wis_folder mac_dash out

  wis_folder="config_${CONFIG}"
  mac_dash="$(mac_dash "$HOST_MAC")"
  out="/srv/tftp/grub/grub.cfg-${mac_dash}"

  case "$CONFIG" in
    F)
      tee "$out" >/dev/null <<EOF
set timeout=5

menuentry "${wis_folder} L10 Image" {
    linux (http,192.168.1.2:8080)/${wis_folder}/vmlinuz \
        boot=live root=/dev/ram0 live-netdev=enP5p9s0 \
        fetch=http://192.168.1.2:8080/${wis_folder}/${wis_folder}.iso \
        console=ttyS0,115200 console=tty1 fsck.mode=skip ip=dhcp rw vga=0x314 nomodeset ---
    initrd (http,192.168.1.2:8080)/${wis_folder}/initrd.img
}
EOF
      ;;
    7)
      tee "$out" >/dev/null <<EOF
set timeout=5

menuentry "${wis_folder}L10 Image" {
        linux (http,192.168.1.2:8080)/${wis_folder}/vmlinuz \\
                boot=live live-media-path=/live netboot=http \\
                fetch=http://192.168.1.2:8080/${wis_folder}/filesystem.squashfs \\
                ip=dhcp rw fsck.mode=skip console=ttyS0,115200 console=tty1 nomodeset ---
        initrd (http,192.168.1.2:8080)/${wis_folder}/initrd.img
}
EOF
      ;;
    2|4|6|A|A1|B|H1|I|E)
      tee "$out" >/dev/null <<EOF
set timeout=5

menuentry "Configs 2-6 A,B Wistron Image (RAM)" {
        linux   (http,192.168.1.2:8080)/wis_vmlinuz ip=dhcp root=/dev/nfs nfsroot=192.168.1.2:/srv/tftp/wis_rootfs_copy
        initrd  (http,192.168.1.2:8080)/wis_initrd_1
}
EOF
      ;;
    *)
      err "No grub.cfg template defined for config $CONFIG"
      exit 1
      ;;
  esac

  chmod 0644 "$out"
  echo "Wrote: $out"
}

bmc_check_cmd() {
  if [[ "${CONFIG:-}" == "7" ]]; then
    sshpass -p changeme ssh \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 \
      -o LogLevel=ERROR \
      root@"$BMC_IP" 'exit' >/dev/null 2>&1
  else
    ipmi chassis power status >/dev/null 2>&1
  fi
}

wait_for_bmc_ip() {
  local bmc_mac_colon start current elapsed

  bmc_mac_colon="$(mac_colon "$BMC_MAC")"
  start="$(date +%s)"

  while true; do
    current="$(date +%s)"
    elapsed=$((current - start))

    if ((elapsed > 5 * 60)); then
      err "It is taking too long to get a BMC IP, please check the system"
      echo "Possible issues: system is not on, hardware issue"
      exit 1
    fi

    BMC_IP=$(awk -v mac="$bmc_mac_colon" '
      /lease/ {ip=$2}
      /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip}
      found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -n "$BMC_IP" ]]; then
      echo "IP Address for BMC: $BMC_IP"
      return 0
    fi

    printf "%02dh %02dm %02ds - Waiting for BMC IP assignment...\n" \
      $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60))
    sleep 5
  done
}

wait_for_bmc_response() {
  local start current elapsed

  start="$(date +%s)"

  while ! bmc_check_cmd; do
    current="$(date +%s)"
    elapsed=$((current - start))

    if ((elapsed > 5 * 60)); then
      err "It is taking too long to get a valid BMC response"
      echo "This is most likely a BMC hardware issue"
      exit 1
    fi

    echo
    printf "%02dh %02dm %02ds - Waiting for valid BMC response......\n" \
      $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60))
    sleep 5
  done

  echo "INFO - IPMI response received!"
}

power_on_system() {
  if [[ "${CONFIG:-}" == "7" ]]; then
    echo "INFO - Powering on system"
    sshpass -p changeme ssh -tt \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 \
      -o LogLevel=ERROR \
      root@"$BMC_IP" 'start -script /SYS'
  else
    echo "INFO - Changing Boot Device to PXE"
    ipmi chassis bootdev pxe

    echo
    echo "INFO - Powering on system"
    ipmi chassis power on
  fi
}

wait_for_host_ip() {
  local host_mac_colon start current elapsed

  host_mac_colon="$(mac_colon "$HOST_MAC")"
  start="$(date +%s)"

  while true; do
    current="$(date +%s)"
    elapsed=$((current - start))

    if ((elapsed > 10 * 60)); then
      err "It is taking too long to get a HOST IP, please check if the host is on"
      echo "Recommended Action:"
      echo "  - Re-run this boot.sh while monitoring the system via BIOS serial to confirm the system is booting correctly."
      echo "  - You can monitor the BIOS serial output using:"
      echo "      ./bios_serial <-i IP_ADDRESS | -m MAC_ADDRESS>"
      echo
      exit 1
    fi

    HOST_IP=$(awk -v mac="$host_mac_colon" '
      /lease/ {ip=$2}
      /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip}
      found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -n "$HOST_IP" ]]; then
      echo "IP Address for HOST: $HOST_IP"
      return 0
    fi

    printf "%02dh %02dm %02ds - Waiting for Host IP assignment...\n" \
      $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60))
    sleep 5
  done
}

ssh_ready() {
  ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o ConnectionAttempts=1 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o PreferredAuthentications=publickey \
    -o PasswordAuthentication=no \
    nvidia@"$HOST_IP" 'echo READY' >/dev/null 2>&1
}

wait_for_ssh_ready() {
  local start now elapsed

  start="$(date +%s)"

  while ! ssh_ready; do
    now="$(date +%s)"
    elapsed=$((now - start))

    if ((elapsed > 15 * 60)); then
      err "SSH is not fully up (handshake/command) on $HOST_IP after 900 seconds."
      echo "Note: port 22 may be open before sshd is ready (banner exchange timeouts)."
      exit 1
    fi

    printf "%02dh %02dm %02ds - Waiting for SSH handshake/command on HOST %s...\n" \
      $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60)) "$HOST_IP"
    sleep 5
  done

  echo "INFO - SSH is fully up on $HOST_IP"
}

check_key_auth() {
  echo "INFO - Adding SSH host to known_hosts file"
  ssh-keyscan -H "$HOST_IP" >> ~/.ssh/known_hosts 2>/dev/null
  echo

  # check if the authentication key works when SSHing into the Gaines system
  # if it does not work, its 99% not in the right OS (like the stock Ubuntu OS that it comes with)
  if ! ssh -o BatchMode=yes -o ConnectTimeout=5 nvidia@"$HOST_IP" "exit" 2>/dev/null; then
    err "SSH key authentication to nvidia@$HOST_IP failed."
    echo "Possible Cause: The target system is not running the Wistron L10 PXE OS."
    echo "Recommended Action:"
    echo "  - Re-run this boot.sh while monitoring the system via BIOS serial to confirm the correct OS is loaded."
    echo "  - You can monitor the BIOS serial output using:"
    echo "      ./bios_serial <-i IP_ADDRESS | -m MAC_ADDRESS>"
    echo

    if [[ "${CONFIG:-}" != "7" ]]; then
      echo "INFO - Changing Boot Device to PXE"
      ipmi chassis bootdev pxe
      echo
      echo "Powering off system"
      ipmi chassis power off
    fi
    exit 1
  fi

  echo "INFO - SSH key authentication works."
}

run_boot_flow() {
  require_cmd ssh
  require_cmd ssh-keyscan

  if [[ "${CONFIG:-}" == "7" ]]; then
    require_cmd sshpass
  else
    require_cmd ipmitool
  fi

  echo
  echo "==> Write the matching grub config"
  write_grub_config

  echo
  echo "==> Wait for BMC IP"
  wait_for_bmc_ip

  echo
  echo "==> Wait for valid BMC/IPMI response"
  wait_for_bmc_response

  echo
  echo "==> Set PXE boot and power on"
  power_on_system

  echo
  echo "==> Wait for host IP"
  wait_for_host_ip

  echo
  echo "==> Wait for SSH readiness"
  wait_for_ssh_ready

  echo
  echo "==> Add host to known_hosts and check key auth"
  check_key_auth

  if [[ "$LIVE_CHILD" == "1" ]]; then
    echo
    echo "INFO - Boot flow complete. SSH is ready:"
    echo "       ssh nvidia@$HOST_IP"
    return 0
  fi

  echo "INFO - SSHing into nvidia@$HOST_IP"
  exec ssh nvidia@"$HOST_IP"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--tag)
      TAG_MODE=1
      shift
      if [[ $# -gt 0 && "$1" != -* ]]; then
        SERVICE_TAG="$1"
        shift
      fi
      ;;
    -m|--manual)
      MANUAL_MODE=1
      shift
      ;;
    -b|--bmc-mac)
      shift
      if [[ $# -eq 0 || "$1" == -* ]]; then
        err "-b requires a BMC MAC value."
        exit 1
      fi
      BMC_MAC="$1"
      shift
      ;;
    -s|--sys-mac)
      shift
      if [[ $# -eq 0 || "$1" == -* ]]; then
        err "-s requires a system MAC value."
        exit 1
      fi
      HOST_MAC="$1"
      shift
      ;;
    -c)
      shift
      if [[ $# -eq 0 || "$1" == -* ]]; then
        err "-c requires a config value."
        exit 1
      fi
      CONFIG="$1"
      shift
      ;;
    -l|--live)
      LIVE_MODE=1
      shift
      ;;
    --live-child)
      LIVE_CHILD=1
      shift
      ;;
    --live-bios-child)
      LIVE_BIOS_CHILD=1
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      err "Unknown option: $1"
      print_help
      exit 1
      ;;
  esac
done

if [[ "$LIVE_BIOS_CHILD" == "1" ]]; then
  run_live_bios_child
  exit 0
fi

if [[ "$LIVE_CHILD" == "1" ]]; then
  validate_child_inputs
  run_boot_flow
  exit 0
fi

require_station_tmux_session

if [[ "$TAG_MODE" == "1" && ("$MANUAL_MODE" == "1" || -n "$BMC_MAC" || -n "$HOST_MAC" || -n "$CONFIG") ]]; then
  err "-t/--tag cannot be combined with -m/--manual, -b/--bmc-mac, -s/--sys-mac, or -c."
  print_help
  exit 1
fi

if [[ "$TAG_MODE" == "1" ]]; then
  load_auto_inputs
elif is_backend_mode && [[ "$MANUAL_MODE" == "0" && -z "$BMC_MAC" && -z "$HOST_MAC" && -z "$CONFIG" ]]; then
  load_station_inputs
else
  load_inputs
fi

if [[ "$LIVE_MODE" == "1" ]]; then
  start_live_tmux
  exit 0
fi

run_boot_flow

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
