#!/bin/bash

# as of 7/12/25, there are 22 stations, 4 table tops ones and 18 (1 rack)

URL='https://backend.tss.wistronlabs.com/api/v1/stations'

for i in {1..4}; do
    curl -X POST "$URL" \
        -H "Content-Type: application/json" \
        -d "{\"station_name\": \"$i\"}"
done

for i in {110..118}; do
    curl -X POST "$URL" \
        -H "Content-Type: application/json" \
        -d "{\"station_name\": \"$i\"}"
done

for i in {127..136}; do
    curl -X POST "$URL" \
        -H "Content-Type: application/json" \
        -d "{\"station_name\": \"$i\"}"
done

