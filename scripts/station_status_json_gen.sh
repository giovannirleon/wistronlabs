#!/usr/bin/env bash
stations=( stn_1 stn_2 stn_3 stn_4 stn_27 stn_28 stn_29 stn_30 stn_31 stn_32 stn_33 stn_34 stn_35 stn_36 )
out=/var/www/html/station_status.json

printf '[\n'   >  "$out"
first=true
for st in "${stations[@]}"; do
  [[ $first == true ]] && first=false || printf ',\n' >> "$out"
  ./check_station.sh "$st"  >> "$out"
done
printf '\n]\n' >> "$out"
