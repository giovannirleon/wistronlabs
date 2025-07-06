#!/bin/sh

# start ib_write_bw server in background
ib_write_bw -d mlx5_0 -i 1 -p 11000 -D 3 -F --report_gbits > /tmp/ib_write_bw_mlx5_0and1.out &

sleep 1

# start ib_write_bw client
ib_write_bw -d mlx5_1 -i 1 -p 11000 -D 3 -F 0.0.0.0 --report_gbits >> /tmp/ib_write_bw_mlx5_0and1.out

wait

sleep 1

# start ib_write_bw server in background
ib_write_bw -d mlx5_4 -i 1 -p 11000 -D 3 -F --report_gbits > /tmp/ib_write_bw_mlx5_4and5.out &

sleep 1

# start ib_write_bw client
ib_write_bw -d mlx5_5 -i 1 -p 11000 -D 3 -F 0.0.0.0 --report_gbits >> /tmp/ib_write_bw_mlx5_4and5.out

wait



# ib_write_bw -d mlx5_0 -i 1 -p 11000 -D 3 -F --report_gbits &
# timeout 10s ib_write_bw -d mlx5_1 -i 1 -p 11000 -D 3 -F 0.0.0.0 --report_gbits --run_infinitely 

# sleep 1
# ib_write_bw -d mlx5_4 -i 1 -p 11000 -D 3 -F --report_gbits &
# timeout 10s ib_write_bw -d mlx5_5 -i 1 -p 11000 -D 3 -F 0.0.0.0 --report_gbits --run_infinitely 