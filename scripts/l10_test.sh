#!/bin/bash
# About:
#   Runs the L10 diagnostic workflow for a selected system from the current
#   station tmux session.
#   Backend mode uses the station's backend assignment. Field mode uses local
#   stations, prompts for the service tag only for local log folder naming,
#   and defaults to FIELD_DEFAULT_CONFIG or the field stations JSON default.
#
# Usage:
#   WISTRON_MODE=backend ./l10_test.sh [options]
#   WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./l10_test.sh [options]
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/err.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/runtime_mode.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_cmd.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_server_location.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_internal_api_key.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/fetch_station_list.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/prompt_service_tag.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/curl_auth.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/normalize_mac_colon.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/ipmi.sh"

LIVE_MODE=0
LIVE_RIGHT_PANE_ID=""
LIVE_SSH_READY=0
MANUAL_MODE=0
SERVICE_TAG=""
BMC_MAC=""
HOST_MAC=""
CONFIG=""

print_help() {
  if is_field_mode; then
    cat <<EOF
Usage:
  ./l10_test.sh [options]
  Must be run inside a valid station tmux session.

Options:
  -b, --bmc-mac BMC_MAC
      Provide the BMC MAC instead of being prompted.
  -s, --sys-mac SYS_MAC
      Provide the system MAC instead of being prompted.
  -l, --live
      Show BIOS serial on the right until SSH is fully up, then return to one pane.
  -o, --options
      Open interactive module picker.
  -f, --fru-only
      FRU only mode; skip diag upload and L10 validation run.
  -p, --power-on
      Keep the unit powered on after the script ends.
  -h, --help
      Show this help and exit.

Field mode behavior:
  - The station only identifies the tmux collaboration session.
  - You will be prompted for SERVICE_TAG to create l10_logs/<service_tag>/<run>.
  - BMC and HOST MACs are entered manually unless provided with -b/-s.
  - Config defaults to ${FIELD_DEFAULT_CONFIG:-$(field_default_config)}.
  - Logs stay local; backend PATCHes and remote uploads are skipped.

Examples:
  WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./l10_test.sh
  WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./l10_test.sh -l
  WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./l10_test.sh -b 001a2b3c4d5e
  WISTRON_MODE=field FIELD_DEFAULT_CONFIG=F ./l10_test.sh -b 001a2b3c4d5e -s 00aa11bb22cc
  ./l10_test.sh -o
  ./l10_test.sh -f
  ./l10_test.sh -p
EOF
  else
    cat <<'EOF'
Usage:
  ./l10_test.sh [options]
  Must be run inside a valid station tmux session.

Options:
  -m, --manual
      Manual MAC mode: skip backend MAC pull and prompt for any missing MACs.
  -b, --bmc-mac BMC_MAC
      Manual mode only: provide the BMC MAC instead of being prompted.
  -s, --sys-mac SYS_MAC
      Manual mode only: provide the system MAC instead of being prompted.
  -l, --live
      Show BIOS serial on the right until SSH is fully up, then return to one pane.
  -o, --options
      Open interactive module picker.
  -f, --fru-only
      FRU only mode; skip diag upload and L10 validation run.
  -p, --power-on
      Keep the unit powered on after the script ends.
  -h, --help
      Show this help and exit.

Behavior:
  - This script always uses the system currently assigned to the active station in backend.
  - SERVICE_TAG and CONFIG are always pulled from backend for that station.
  - Without -m, the script also pulls BMC and system MACs from backend.
  - With -m, you may provide -b and/or -s, and any missing MAC will be prompted.

Examples:
  ./l10_test.sh
  ./l10_test.sh -l
  ./l10_test.sh -m
  ./l10_test.sh -m -b 001a2b3c4d5e
  ./l10_test.sh -m -s 00aa11bb22cc
  ./l10_test.sh -m -b 001a2b3c4d5e -s 00aa11bb22cc
  ./l10_test.sh -o
  ./l10_test.sh -f
  ./l10_test.sh -p
EOF
  fi
}

close_live_right_pane() {
  if [[ -n "$LIVE_RIGHT_PANE_ID" ]]; then
    tmux kill-pane -t "$LIVE_RIGHT_PANE_ID" 2>/dev/null || true
    LIVE_RIGHT_PANE_ID=""
  fi
}

live_pre_ssh_exit_cleanup() {
  if [[ "$LIVE_MODE" == "1" && "$LIVE_SSH_READY" == "0" ]]; then
    close_live_right_pane
  fi
}

live_terminate_signal_trap() {
  local signal="$1"

  close_live_right_pane
  trap - EXIT INT TERM HUP QUIT TSTP
  kill -s "$signal" "$$"
}

live_tstp_signal_trap() {
  close_live_right_pane
  trap - TSTP
  kill -s TSTP "$$"
  trap 'live_tstp_signal_trap' TSTP
}

start_live_bios_pane() {
  local script_dir current_pane_id window_target pane_count right_cmd

  require_cmd tmux

  pane_count="$(tmux display-message -p '#{window_panes}')"
  if ((pane_count != 1)); then
    err "Live mode requires the current station window to have exactly one pane. Close extra panes and try again."
    exit 1
  fi

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ ! -x "$script_dir/bios_serial.sh" ]]; then
    err "Expected executable BIOS serial script at $script_dir/bios_serial.sh"
    exit 1
  fi

  current_pane_id="$(tmux display-message -p '#{pane_id}')"
  window_target="$(tmux display-message -p '#S:#I')"
  right_cmd="cd '$script_dir' && env -u TMUX WISTRON_MODE='$WISTRON_MODE' FIELD_STATIONS_FILE='$FIELD_STATIONS_FILE' FIELD_DEFAULT_CONFIG='${FIELD_DEFAULT_CONFIG:-}' SERVER_LOCATION='${SERVER_LOCATION:-}' '$script_dir/bios_serial.sh' -m '$BMC_MAC'"

  LIVE_RIGHT_PANE_ID="$(tmux split-window -h -P -F '#{pane_id}' -t "$current_pane_id" "$right_cmd")"
  tmux select-layout -t "$window_target" even-horizontal
  tmux select-pane -t "$current_pane_id"

  trap 'live_pre_ssh_exit_cleanup' EXIT
  trap 'live_terminate_signal_trap INT' INT
  trap 'live_terminate_signal_trap TERM' TERM
  trap 'live_terminate_signal_trap HUP' HUP
  trap 'live_terminate_signal_trap QUIT' QUIT
  trap 'live_tstp_signal_trap' TSTP
}

finish_live_pre_ssh_phase() {
  LIVE_SSH_READY=1
  close_live_right_pane
  trap - EXIT INT TERM HUP QUIT TSTP
}

# Allow help output before any env validation.
for arg in "$@"; do
  if [[ "$arg" == "-h" || "$arg" == "-H" ]]; then
    print_help
    exit 0
  fi
done

if is_backend_mode; then
  require_server_location
  require_internal_api_key
fi

require_cmd jq
require_cmd curl

RUN_OPTION_PICKER=0
FRU_ONLY_MODE=0
KEEP_POWER_ON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|-M|--manual)
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
    -o|-O|--options)
      RUN_OPTION_PICKER=1
      shift
      ;;
    -f|-F|--fru-only)
      FRU_ONLY_MODE=1
      shift
      ;;
    -p|-P|--power-on)
      KEEP_POWER_ON=1
      shift
      ;;
    -l|-L)
      LIVE_MODE=1
      shift
      ;;
    \?|-*)
      err "Unknown option: $1"
      print_help
      exit 1
      ;;
    *)
      err "Unexpected argument(s): $*"
      print_help
      exit 1
      ;;
  esac
done

api_base=""
api_auth_hdr=()

if is_backend_mode; then
  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
  api_auth_hdr=(-H "Authorization: Bearer $INTERNAL_API_KEY")
fi

backend_get_system() {
  # prints JSON on stdout; returns nonzero on failure
  curl -fsS --max-time 5 "${api_base}/systems/${SERVICE_TAG}"
}

backend_patch_mac() {
  # $1 = endpoint suffix ("bmc_mac" | "host_mac"), $2 = mac (AA.. no separators OK)
  local field="$1"
  local val="$2"

  local payload
  payload="$(jq -nc --arg field "$field" --arg v "$val" '{($field): $v}')"
  curl -sS -X PATCH "${api_base}/systems/${SERVICE_TAG}/${field}" \
    "${api_auth_hdr[@]}" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

mapfile -t STATIONS < <(fetch_station_list)

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
SESSION_NUMBER="${SESSION_NAME#stn_}"
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

if is_backend_mode; then
  http_code="$(curl -s -o /dev/null -w "%{http_code}" \
    "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations/$SESSION_NUMBER")"

  if [[ "$http_code" != "200" ]]; then
    err "Backend API returned HTTP $http_code for station $SESSION_NUMBER"
    exit 1
  fi

  STATION_SERVICE_TAG="$(curl -s \
    "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations/$SESSION_NUMBER" | jq -r '.system_service_tag')"

  if [[ -z "$STATION_SERVICE_TAG" || "$STATION_SERVICE_TAG" == "null" ]]; then
    err "No system is currently assigned to Station $SESSION_NUMBER. Assign a unit to this station and re-run."
    exit 1
  fi

  SERVICE_TAG="$STATION_SERVICE_TAG"

  if [[ "$MANUAL_MODE" != "1" && (-n "$BMC_MAC" || -n "$HOST_MAC") ]]; then
    err "-b/--bmc-mac and -s/--sys-mac require -m manual mode."
    print_help
    exit 1
  fi

  CONFIG_TMP="$(mktemp)"

  HTTP_CODE="$(curl -sS -w "%{http_code}" -o "$CONFIG_TMP" \
    "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/systems/$SERVICE_TAG")" || {
      err "Failed to reach backend when fetching config for $SERVICE_TAG."
      rm -f "$CONFIG_TMP"
      exit 1
  }

  if [[ "$HTTP_CODE" != "200" ]]; then
    case "$HTTP_CODE" in
      404)
        err "System $SERVICE_TAG not found in tracking website."
        ;;
      *)
        err "Backend returned HTTP $HTTP_CODE when fetching config for $SERVICE_TAG."
        ;;
    esac
    rm -f "$CONFIG_TMP"
    exit 1
  fi

  CONFIG="$(jq -r '.config // empty' < "$CONFIG_TMP")"
  rm -f "$CONFIG_TMP"

  if [[ -z "$CONFIG" || "$CONFIG" == "null" ]]; then
    err "System $SERVICE_TAG has no known config in tracking website."
    exit 1
  fi

  echo "INFO - SERVICE TAG FROM STATION $SESSION_NUMBER: $SERVICE_TAG"

  if [[ "$MANUAL_MODE" == "1" ]]; then
    if [[ -z "$BMC_MAC" ]]; then
      read -r -p "Enter BMC MAC address (e.g., 001A2B3C4D5E): " BMC_MAC
    fi
    if [[ -z "$HOST_MAC" ]]; then
      read -r -p "Enter HOST MAC address (e.g., 001A2B3C4D5E): " HOST_MAC
    fi
  else
    if sys_json="$(backend_get_system 2>/dev/null)"; then
      bmc_raw="$(printf '%s' "$sys_json" | jq -r '.bmc_mac // empty')"
      host_raw="$(printf '%s' "$sys_json" | jq -r '.host_mac // empty')"

      if [[ -n "$bmc_raw" && -n "$host_raw" && "$bmc_raw" != "null" && "$host_raw" != "null" ]]; then
        BMC_MAC="$bmc_raw"
        HOST_MAC="$host_raw"
        echo "INFO - Using BMC/HOST MAC from backend for $SERVICE_TAG"
      fi
    fi

    if [[ -z "$BMC_MAC" || -z "$HOST_MAC" ]]; then
      read -r -p "Enter BMC MAC address (e.g., 001A2B3C4D5E): " BMC_MAC
      read -r -p "Enter HOST MAC address (e.g., 001A2B3C4D5E): " HOST_MAC
    fi
  fi
else
  MANUAL_MODE=1
  CONFIG="$(field_default_config | tr '[:lower:]' '[:upper:]')"
  SERVICE_TAG="$(prompt_service_tag)"
  echo "INFO - Field mode using station $SESSION_NUMBER and config $CONFIG"

  if [[ -z "$BMC_MAC" ]]; then
    read -r -p "Enter BMC MAC address (e.g., 001A2B3C4D5E): " BMC_MAC
  fi
  if [[ -z "$HOST_MAC" ]]; then
    read -r -p "Enter HOST MAC address (e.g., 001A2B3C4D5E): " HOST_MAC
  fi
fi

GB300_MASTER_MODULE_LIST=(
  "Inventory"
  "CxPcieProperties"
  "SsdPcieProperties"
  "TegraCpu"
  "TegraMemory"
  "CpuMemorySweep"
  "TegraClink"
  "Gpustress"
  "Gpumem"
  "Pcie"
  "Connectivity"
  "NvlBwStress"
  "NvlBwStressBg610"
  "C2C"
  "C2CGpuPulsePower1kHz"
  "C2CGpuPulsePower4kHz"
  "CpuGpuSyncPulsePower1Hz50duty"
  "CpuGpuSyncPulsePower50Hz50duty"
  "CpuGpuSyncPulsePower500Hz50duty"
  "CpuGpuSyncPulsePower1kHz50duty"
  "CpuGpuSyncPulsePower4kHz50duty"
  "Thermal"
  "CxeyegradeStart"
  "CxeyegradeStop"
  "Cx8GpuDirectLoopback"
  "Cx8GpuDirectCrossGpu_ETH"
  "CpuCx8Phy"
  "Cx8GpuDirectCrossGpu_IB"
  "BF3PcieInterfaceTraffic"
  "Ssd"
  "DimmStress"
)

GB200_MASTER_MODULE_LIST=(
  "inforom"
  "Checkinforom"
  "Inventory"
  "CxPcieProperties"
  "BfPcieProperties"
  "BfMgmtPcieProperties"
  "WisSsdPcieProperties"
  "TegraCpu"
  "TegraMemory"
  "CpuMemorySweep"
  "TegraClink"
  "Gpustress"
  "Gpumem"
  "Pcie"
  "Connectivity"
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
  "ThermalSteadyState"
  "CxeyegradeStart"
  "CxeyegradeStop"
  "IbStressBf3PhyLoopback"
  "IbStressBf3Loopout"
  "IbStressCx7PhyLoopback"
  "IbConfigureCx7Cables400G_8X"
  "IbStressLoopout400G_8X"
  "IbConfigureCx7Cables400G_4X"
  "IbStressLoopout400G_4X"
  "IbStressCables"
  "Cx8GpuDirectLoopback"
  "Cx8GpuDirectCrossGpu"
  "Bf3PcieInterfaceTraffic"
  "Ssd"
  "C2C"
  "DimmStress"
)

CONFIG_F_MASTER_MODULE_LIST=(
  "inforom"
  "Checkinforom"
  "Inventory"
  "CxPcieProperties"
  "CxPcieProperties_C8240"
  "WisSsdPcieProperties_M2"
  "SsdPciePropertiesE1S"
  "UsbPcieProperties"
  "TegraCpu"
  "TegraMemory"
  "CpuMemorySweep"
  "TegraClink"
  "Gpustress"
  "Gpumem"
  "Pcie"
  "Connectivity"
  "NvlBwStress"
  "NvlBwStressBg610"
  "C2C"
  "CpuGpuSyncPulsePower"
  "ThermalSteadyState"
  "CxeyegradeStart"
  "DisableAcs"
  "CxeyegradeStop"
  "Cx8GpuDirectLoopback_ETH"
  "Cx8GpuDirectCrossNIC_ETH"
  "Cx8GpuDirectCrossNIC_IB"
  "Cx8CpuCrossNIC_ETH"
  "Cx8CpuCrossNIC_IB"
  "Cx8CpuLoopback"
  "BF3PcieInterfaceTraffic"
  "Ssd"
  "DimmStress"
  "SyslogErrorCheck"
  "KernLogErrorCheck"
  "DmesgLogErrorCheck"
  "SyslogAERCheck"
  "KernLogAERCheck"
  "DmesgLogAERCheck"
)

CONFIG_H_MASTER_MODULE_LIST=(
  "inforom"
  "Checkinforom"
  "Inventory"
  "CxPcieProperties_Gen5"
  "CxPcieProperties_Gen6"
  "BfPcieProperties"
  "BfMgmtPcieProperties"
  "SsdPciePropertiesM2"
  "SsdPciePropertiesE1S"
  "Ssd"
  "UsbPcieProperties"
  "TegraCpu"
  "TegraMemory"
  "CpuMemorySweep"
  "TegraClink"
  "Gpustress"
  "Gpumem"
  "PerfBenchmark_GEMM"
  "Pcie"
  "Connectivity"
  "NvlBwStress"
  "NvlBwStressBg610"
  "C2C"
  "CpuGpuSyncPulsePower"
  "ThermalSteadyState"
  "PerfBenchmark_FP8_GEMM100"
  "PerfBenchmark_FP8_GEMM65"
  "Thermal"
  "CxeyegradeStart"
  "CxeyegradeStop"
  "DisableAcs"
  "Cx8GpuDirectLoopback_ETH"
  "Cx8GpuDirectExtLoopback_ETH"
  "Cx8GpuDirectCrossNIC_ETH"
  "Cx8GpuDirectCrossNIC_IB"
  "Cx8CpuCrissCrossNIC_ETH"
  "Cx8CpuCrossNIC_ETH"
  "Cx8CpuCrossNIC_IB"
  "Cx8CpuLoopback"
  "BF3PcieInterfaceTraffic"
  "DimmStress"
  "SyslogErrorCheck"
  "KernLogErrorCheck"
  "DmesgLogErrorCheck"
  "SyslogAERCheck"
  "KernLogAERCheck"
  "DmesgLogAERCheck"
)

CONFIG_D_MASTER_MODULE_LIST=(
  "inforom"
  "Checkinforom"
  "Inventory"
  "CxPcieProperties_Gen5"
  "BfPcieProperties"
  "BfMgmtPcieProperties"
  "SsdPciePropertiesE1S"
  "SsdPciePropertiesM2"
  "UsbPcieProperties"
  "TegraCpu"
  "TegraMemory"
  "CpuMemorySweep"
  "TegraClink"
  "Gpustress"
  "Gpumem"
  "PerfBenchmark_GEMM"
  "Pcie"
  "Connectivity"
  "NvlBwStress"
  "NvlBwStressBg610"
  "C2C"
  "CpuGpuSyncPulsePower"
  "ThermalSteadyState"
  "CxeyegradeStart"
  "CxeyegradeStop"
  "DisableAcs"
  "Cx8GpuDirectLoopback_ETH"
  "Cx8GpuDirectExtLoopback_ETH"
  "Cx8GpuDirectCrossNIC_ETH"
  "Cx8GpuDirectCrossNIC_IB"
  "Cx8CpuCrissCrossNIC_ETH"
  "Cx8CpuCrossNIC_ETH"
  "Cx8CpuCrossNIC_IB"
  "Cx8CpuLoopback"
  "BF3PcieInterfaceTraffic"
  "Ssd"
  "DimmStress"
  "SyslogErrorCheck"
  "KernLogErrorCheck"
  "DmesgLogErrorCheck"
  "SyslogAERCheck"
  "KernLogAERCheck"
  "DmesgLogAERCheck"
)


if [[ "$CONFIG" == "2" || "$CONFIG" == "4" || "$CONFIG" == "6" ]]; then
    MASTER_MODULE_LIST=("${GB200_MASTER_MODULE_LIST[@]}")
    DIAG_FILE="l10_diag_r8_386.tgz"
elif [[ "$CONFIG" == "7" ]]; then
    MASTER_MODULE_LIST=("${GB200_MASTER_MODULE_LIST[@]}")
     DIAG_FILE="diag_629-24975-0000-FLD-43749_rev13.tgz"
elif [[ "$CONFIG" == "A" || "$CONFIG" == "B" || "$CONFIG" == "I" || "$CONFIG" == "E" ]]; then
    MASTER_MODULE_LIST=("${GB300_MASTER_MODULE_LIST[@]}")
    DIAG_FILE="629-24059-0000-FLD-43538.tgz"
elif [[ "$CONFIG" == "F" ]]; then
    MASTER_MODULE_LIST=("${CONFIG_F_MASTER_MODULE_LIST[@]}")
    DIAG_FILE="629-24059-0000-FLD-50611-rev1.tgz"
elif [[ "$CONFIG" == "H1" ]]; then
    MASTER_MODULE_LIST=("${CONFIG_H_MASTER_MODULE_LIST[@]}")
    DIAG_FILE="629-24059-0000-FLD-60002-rev3.tgz"
elif [[ "$CONFIG" == "D" ]]; then
    MASTER_MODULE_LIST=("${CONFIG_D_MASTER_MODULE_LIST[@]}")
    DIAG_FILE="629-24059-0000-FLD-60002-rev3.tgz"
else
    err "This config ($CONFIG) has not been implemented at L10 yet."
    exit 1
fi
# Per-config HTTP folder under /var/www/html (ex: config_6, config_F)
WIS_FOLDER="config_${CONFIG}"


# defines the base modules that need to be skipped over for each configuration. 
# note that these might change as we get more testing equiptment
case "$CONFIG" in
    2)
        SKIPPED_MODULES=(
            "Bf3PcieInterfaceTraffic"
            "CxeyegradeStart"
            "CxeyegradeStop"
            "IbStressBf3PhyLoopback"
            "IbStressBf3Loopout"
            "IbStressCx7PhyLoopback"
            "IbConfigureCx7Cables400G_8X"
            "IbStressLoopout400G_8X"
            "IbConfigureCx7Cables400G_4X"
            "IbStressLoopout400G_4X"
            "IbStressCables"
            "Cx8GpuDirectLoopback"
            "Cx8GpuDirectCrossGpu"
        )
        ;;
    4)
        SKIPPED_MODULES=(
            "Bf3PcieInterfaceTraffic"
            "CxeyegradeStart"
            "CxeyegradeStop"
            "IbStressBf3PhyLoopback"
            "IbStressBf3Loopout"
            "Cx8CpuCrossNIC_ETH"
            "Cx8CpuCrossNIC_IB"
            "Cx8GpuDirectCrossNIC_ETH"
            "Cx8GpuDirectCrossNIC_IB"
        )
        ;;
    6)
        SKIPPED_MODULES=(
            "Bf3PcieInterfaceTraffic"
            "IbStressBf3PhyLoopback"
            "IbStressBf3Loopout"
            "IbStressCx7PhyLoopback"
            "IbConfigureCx7Cables400G_8X"
            "IbStressLoopout400G_8X"
            "IbConfigureCx7Cables400G_4X"
            "IbStressLoopout400G_4X"
            "IbStressCables"
            "Cx8GpuDirectLoopback"
            "Cx8GpuDirectCrossGpu"
        )
        ;;
     7)
        SKIPPED_MODULES=(
            "BfPcieProperties"
            "BfMgmtPcieProperties"
            "Bf3PcieInterfaceTraffic"
            "Connectivity"
            "NvlBwStress"
            "NvlBwStressBg610"
            "Cx8CpuCrossNIC_ETH"
            "Cx8CpuCrossNIC_IB"
            "Cx8GpuDirectCrossNIC_IB"
            "Cx8GpuDirectLoopback"
	          "Cx8GpuDirectCrossNIC_ETH" #needs to be fixed
        )
        ;;
    A)
        SKIPPED_MODULES=(
            "BF3PcieInterfaceTraffic"
            "Cx8GpuDirectLoopback"
            "Cx8GpuDirectCrossGpu_ETH"
            "CpuCx8Phy"
            "Cx8GpuDirectCrossGpu_IB"
        )
        ;;
    I)
        SKIPPED_MODULES=(
            "BF3PcieInterfaceTraffic"
            "CxeyegradeStop"
            "Cx8GpuDirectLoopback"
            "Cx8GpuDirectCrossGpu_ETH"
            "CpuCx8Phy"
            "Cx8GpuDirectCrossGpu_IB"
        )
        ;;
    B)
        SKIPPED_MODULES=(
            "BF3PcieInterfaceTraffic"
            "CxeyegradeStop"
            "Cx8GpuDirectLoopback"
            "Cx8GpuDirectCrossGpu_ETH"
            "CpuCx8Phy"
            "Cx8GpuDirectCrossGpu_IB"
        )
        ;;
    F)
        SKIPPED_MODULES=(
            "Cx8GpuDirectCrossNIC_IB"
            "Cx8CpuCrossNIC_IB"
            "SsdPciePropertiesE1S"
        )
        ;;
    H1)
        SKIPPED_MODULES=(
            "PerfBenchmark_GEMM"
            "Cx8GpuDirectCrossNIC_IB"
            "Cx8CpuCrossNIC_IB"
            #"Cx8CpuLoopback"
            "BF3PcieInterfaceTraffic"
        );;
    D)
        SKIPPED_MODULES=(
            "Cx8GpuDirectLoopback_ETH"
            "Cx8GpuDirectExtLoopback_ETH"
            "Cx8GpuDirectCrossNIC_ETH"
            "Cx8GpuDirectCrossNIC_IB"
            "Cx8CpuCrissCrossNIC_ETH"
            "Cx8CpuCrossNIC_ETH"
            "Cx8CpuCrossNIC_IB"
            "Cx8CpuLoopback"
            "BF3PcieInterfaceTraffic"
        );;
    E)
        SKIPPED_MODULES=(
            "BF3PcieInterfaceTraffic"
        );;
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
if [[ "$RUN_OPTION_PICKER" -eq 1 ]]; then

	    while true; do
	        selected=$(printf "%s\n" "${CONFIG_LIST[@]}" | fzf --multi \
	        --prompt="Select options: " \
	        --bind "tab:toggle" \
	        --header="Below are the options for config '${CONFIG}' TAB to toggle, ENTER to confirm")
	        if [[ -z "$selected" ]]; then
	            echo "Error - you must pick at least ONE module to run"
	        else
            echo "INFO - Only running:"
            echo "$selected"
            break
        fi
	    done
	
	    #creates the formatted added modules string (one liner, comma separated, comma a beginning, no comma a beginning if empty)
	    SELECTED_MODULES_FORMATTED=$(
	        if [ -n "$selected" ]; then
	            printf "%s\n" "$selected" | paste -sd, - | sed "s/^inforom,//g"
	        fi
	    )
	else
	    SELECTED_MODULES_FORMATTED=""
	fi

#creates the formatted added modules string (one liner, comma separated)
SKIPPED_MODULES_FORMATTED=$(IFS=,; echo "${SKIPPED_MODULES[*]}")

TEST_ARG=""
if [[ ! -z $SELECTED_MODULES_FORMATTED ]]; then
    TEST_ARG="--test='$SELECTED_MODULES_FORMATTED'"
else
    TEST_ARG="--skip_tests='$SKIPPED_MODULES_FORMATTED'"
fi

BMC_MAC="$(normalize_mac_colon "$BMC_MAC")" || { err "Invalid BMC MAC"; exit 1; }
HOST_MAC="$(normalize_mac_colon "$HOST_MAC")" || { err "Invalid HOST MAC"; exit 1; }

if is_backend_mode; then
  # --- PATCH MACs to backend (always do this once we have them) ---
  resp_bmc="$(backend_patch_mac "bmc_mac" "$(echo "$BMC_MAC" | tr -d ':')" )"
  bmc_err="$(echo "$resp_bmc" | jq -r '.error // empty' 2>/dev/null || true)"
  if [[ -n "$bmc_err" ]]; then
    err "Cannot update BMC MAC, $bmc_err"
    echo ""
    exit 1
  fi

  resp_host="$(backend_patch_mac "host_mac" "$(echo "$HOST_MAC" | tr -d ':')" )"
  host_err="$(echo "$resp_host" | jq -r '.error // empty' 2>/dev/null || true)"
  if [[ -n "$host_err" ]]; then
    err "Cannot update HOST MAC, $host_err"
    echo ""
    exit 1
  fi

  echo "INFO - Updated BMC/HOST MAC in tracking website"
  echo ""
fi

if [[ "$LIVE_MODE" == "1" ]]; then
  start_live_bios_pane
fi


# Normalize MAC:
# - remove separators if present (: or -)
# - lowercase
# - reinsert dashes every 2 chars: abcdefghijkl -> ab-cd-ef-gh-ij-kl
MAC_RAW="$(echo "$HOST_MAC" | tr -d ':-' | tr '[:upper:]' '[:lower:]')"
MAC_DASH="$(echo "$MAC_RAW" | sed -E 's/(..)/\1-/g; s/-$//')"

OUT="/srv/tftp/grub/grub.cfg-${MAC_DASH}"

case "$CONFIG" in
  F)
    tee "$OUT" >/dev/null <<EOF
set timeout=5

menuentry "${WIS_FOLDER} L10 Image" {
    linux (http,192.168.1.2:8080)/${WIS_FOLDER}/vmlinuz \
        boot=live root=/dev/ram0 live-netdev=enP5p9s0 \
        fetch=http://192.168.1.2:8080/${WIS_FOLDER}/${WIS_FOLDER}.iso \
        console=ttyS0,115200 console=tty1 fsck.mode=skip ip=dhcp rw vga=0x314 nomodeset ---
    initrd (http,192.168.1.2:8080)/${WIS_FOLDER}/initrd.img
}
EOF
    ;;
  7)
    tee "$OUT" >/dev/null <<EOF
set timeout=5

menuentry "${WIS_FOLDER}L10 Image" {
        linux (http,192.168.1.2:8080)/${WIS_FOLDER}/vmlinuz \\
                boot=live live-media-path=/live netboot=http \\
                fetch=http://192.168.1.2:8080/${WIS_FOLDER}/filesystem.squashfs \\
                ip=dhcp rw fsck.mode=skip console=ttyS0,115200 console=tty1 nomodeset ---
        initrd (http,192.168.1.2:8080)/${WIS_FOLDER}/initrd.img
}
EOF
    ;;
  2|4|6|A|B|I|E)
    tee "$OUT" >/dev/null <<EOF
set timeout=5

menuentry "Configs 2-6 A,B Wistron Image (RAM)" {
        linux   (http,192.168.1.2:8080)/wis_vmlinuz ip=dhcp root=/dev/nfs nfsroot=192.168.1.2:/srv/tftp/wis_rootfs_copy
        initrd  (http,192.168.1.2:8080)/wis_initrd_1
}
EOF
    ;;
  D|H1)
    tee "$OUT" >/dev/null <<EOF
set timeout=5

menuentry "config_F L10 Image" {
    linux (http,192.168.1.2:8080)/config_F/vmlinuz \
        boot=live root=/dev/ram0 live-netdev=enP5p9s0 \
        fetch=http://192.168.1.2:8080/config_F/config_F.iso \
        console=ttyS0,115200 console=tty1 fsck.mode=skip ip=dhcp rw vga=0x314 nomodeset ---
    initrd (http,192.168.1.2:8080)/config_F/initrd.img
}
EOF
    ;;
  *)
    err "No grub.cfg template defined for config $CONFIG"
    exit 1
    ;;
esac

chmod 0644 "$OUT"
echo "Wrote: $OUT"

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

echo ""
echo "System $SERVICE_TAG: Config $CONFIG"

# Helpers to toggle logging
log_off() {  exec 1>&3 2>&4; }   # to terminal only (no file)
log_on()  {  exec 1>&5 2>&5; }   # back through tee (file + terminal)

save_hmc_logs() {
  local hmc_log_file="$1"
  local hmc_log_name

  hmc_log_name="$(basename "$hmc_log_file")"
  echo "INFO - saving HMC logs to file - $hmc_log_name"
  if ! curl_auth -k -X GET \
    "https://$BMC_IP/redfish/v1/Systems/HGX_Baseboard_0/LogServices/EventLog/Entries" | jq >"$hmc_log_file"; then
    echo "WARN - failed to save HMC logs to file, continuing"
    rm -f -- "$hmc_log_file"
  fi
}

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

IPMI_PING_TIMEOUT=$((5 * 60)) # 5 minutes timeout
IPMI_PING_START_TIME=$(date +%s)

# assumes: CONFIG, BMC_IP, IPMI_PING_START_TIME, IPMI_PING_TIMEOUT, err() exist

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


while ! bmc_check_cmd; do
  CURRENT_TIME=$(date +%s)
  ELAPSED_TIME=$((CURRENT_TIME - IPMI_PING_START_TIME))

  if (( ELAPSED_TIME > IPMI_PING_TIMEOUT )); then
    err "It is taking too long to get a valid BMC response"
    echo "This is most likely a BMC hardware issue"
    exit 1
  fi

  echo ""
  printf "%02dh %02dm %02ds - Waiting for valid BMC response...... \n" \
    $((ELAPSED_TIME/3600)) $(((ELAPSED_TIME%3600)/60)) $((ELAPSED_TIME%60))

  sleep 5
done


echo "INFO - IPMI response received!"
echo ""

HMC_PRE_CLEAR_LOG_FILE="$LOG_DIR/hmc_logs_pre_clear_${SERVICE_TAG}_${START_TS}.json"
save_hmc_logs "$HMC_PRE_CLEAR_LOG_FILE"
echo ""

echo "INFO - Clearing HMC Logs"
if ! curl_auth -skL -H 'Expect:' -H 'Content-Length:0' \
  --request POST \
  "https://$BMC_IP/redfish/v1/Systems/HGX_Baseboard_0/LogServices/EventLog/Actions/LogService.ClearLog" | jq; then
  echo "WARN - failed to clear HMC Logs, continuing"
fi
echo ""


if is_backend_mode && [[ "${CONFIG:-}" != "7" ]]; then

    echo "INFO - verifying system PPID"
    SYSTEM_PPID=$(ipmi fru print 0 | grep "Product Serial" | cut -d':' -f2 | xargs)

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
fi  


if [[ "${CONFIG:-}" == "7" ]]; then

    echo ""
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

    echo ""
    echo "INFO - Powering on system"

  ipmi chassis power on
fi


echo ""

HOST_ASSIGNMENT_TIMEOUT=$((10 * 60)) #10 minute timeout
HOST_ASSIGNMENT_START_TIME=$(date +%s)

while true; do

    CURRENT_TIME=$(date +%s)
    ELAPSED_TIME=$((CURRENT_TIME - HOST_ASSIGNMENT_START_TIME))

    if ((ELAPSED_TIME > HOST_ASSIGNMENT_TIMEOUT)); then
        echo ""
        echo "INFO - Recording FRU Data"
        ipmi fru print
        echo ""

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

SSH_READY_TIMEOUT=$((15 * 60))
SSH_READY_START=$(date +%s)

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

while ! ssh_ready; do
  now=$(date +%s)
  elapsed=$((now - SSH_READY_START))

  if (( elapsed > SSH_READY_TIMEOUT )); then
    echo ""
    echo "INFO - Recording FRU Data"
    ipmi fru print
    echo ""

    err "SSH is not fully up (handshake/command) on $HOST_IP after $SSH_READY_TIMEOUT seconds."
    echo "Note: port 22 may be open before sshd is ready (banner exchange timeouts)."
    exit 1
  fi

  printf "%02dh %02dm %02ds - Waiting for SSH handshake/command on HOST %s...\n" \
    $((elapsed/3600)) $(((elapsed%3600)/60)) $((elapsed%60)) "$HOST_IP"
  sleep 5
done

echo "INFO - SSH is fully up on $HOST_IP"

if [[ "$LIVE_MODE" == "1" ]]; then
  finish_live_pre_ssh_phase
fi


echo ""
echo "INFO - Adding SSH host to known_hosts file"
ssh-keyscan -H "$HOST_IP" >> ~/.ssh/known_hosts 2>/dev/null
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
    ipmi chassis bootdev pxe
    echo ""
    echo "Powering off system"
    ipmi chassis power off
    exit 1
fi

echo "INFO - Recording FRU Data"
ipmi fru print

HMC_POST_CLEAR_LOG_FILE="$LOG_DIR/hmc_logs_post_clear_${SERVICE_TAG}_${START_TS}.json"
save_hmc_logs "$HMC_POST_CLEAR_LOG_FILE"
echo ""

if [[ "$FRU_ONLY_MODE" -eq 1 ]]; then
    echo "INFO - FRU only mode enabled; skipping L10 Validation Test"
else
    echo ""
    echo "INFO - Uploading diag bundle to DUT (nvidia@$HOST_IP)..."
    echo ""
    scp "/var/www/html/l10_diags/$DIAG_FILE" nvidia@"$HOST_IP":~/ >/dev/null

	    echo ""
	    echo "INFO - Extracting diag bundle on DUT and cleaning up archive..."
	    echo ""
	    # shellcheck disable=SC2029
	    ssh nvidia@"$HOST_IP" "tar -xzf ~/$DIAG_FILE && rm ~/$DIAG_FILE"

    DIAG_FOLDER="/home/nvidia/$(basename "$DIAG_FILE" .tgz)/"
    echo ""
    echo "INFO - Using diag folder on DUT: $DIAG_FOLDER"
    echo ""

    log_off
    # Runs the L10 validation test by SSHing into the remote system and attaching to a tmux session.
    # The tmux session runs partnerdiag + log copy and exits when finished.
    echo "Running config $CONFIG L10 Validation Tests"
    if is_backend_mode; then
      REMOTE_POST_RUN_CMD='
        ssh-keyscan -H '"$SERVER_LOCATION"'.wistronlabs.com >> ~/.ssh/known_hosts 2>/dev/null || true
        sleep 2
        cd logs
        LATEST=$(ls -1 logs-*.tgz | sort | tail -n1)
        ssh falab@'"$SERVER_LOCATION"'.wistronlabs.com mkdir -p '"$LOG_DIR"'
        scp -r '"$DIAG_FOLDER"'/logs/$LATEST falab@'"$SERVER_LOCATION"'.wistronlabs.com:'"$LOG_DIR"'/\$LATEST
        scp /home/nvidia/output.log falab@'"$SERVER_LOCATION"'.wistronlabs.com:'"$LOG_DIR"'/diag_output.log
        sleep 8
      '
    else
      REMOTE_POST_RUN_CMD='
        sleep 2
      '
    fi

    ssh -t nvidia@"$HOST_IP" 'tmux new-session -As '"$SERVICE_TAG"' "
        sleep 1
        cd '"$DIAG_FOLDER"'
        sudo ./partnerdiag --mfg \
            --run_spec=spec_config'"$CONFIG"'.json \
            --run_on_error --no_bmc \
            '"$TEST_ARG"' \
            2>&1 | tee /home/nvidia/output.log
        '"$REMOTE_POST_RUN_CMD"'
    "'

    sleep 1
    log_on

    if is_field_mode; then
        LATEST_REMOTE_LOG=$(ssh nvidia@"$HOST_IP" "cd '$DIAG_FOLDER/logs' && ls -1 logs-*.tgz | sort | tail -n1" 2>/dev/null || true)
        if [[ -n "$LATEST_REMOTE_LOG" ]]; then
            scp "nvidia@$HOST_IP:$DIAG_FOLDER/logs/$LATEST_REMOTE_LOG" "$LOG_DIR/$LATEST_REMOTE_LOG" >/dev/null
        fi
        scp "nvidia@$HOST_IP:/home/nvidia/output.log" "$LOG_DIR/diag_output.log" >/dev/null 2>&1 || true
    fi

    if [[ -f "$LOG_DIR/diag_output.log" ]]; then
        cat "$LOG_DIR/diag_output.log"
    fi
fi
 
echo ""

if [[ "$KEEP_POWER_ON" -eq 1 ]]; then
    echo "INFO - Keep power on mode enabled; leaving system powered on"
else
    echo "INFO - Powering off system"
    if [[ "${CONFIG:-}" == "7" ]]; then
        sshpass -p changeme ssh -tt \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o ConnectTimeout=5 \
        -o LogLevel=ERROR \
        root@"$BMC_IP" 'stop -script /SYS'
    else
      ipmi chassis power off
    fi
fi

save_hmc_logs "$HMC_POST_CLEAR_LOG_FILE"
log_off
if is_backend_mode; then
    rm -f -- "$LOG_DIR/diag_output.log"
fi
rm -f -- "$OUT"
echo "logs are located at $LOG_DIR"

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
#   Philip Phan - philip_phan@wistron.com
