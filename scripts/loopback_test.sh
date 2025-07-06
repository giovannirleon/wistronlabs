#!/bin/bash

read -p "Enter BMC MAC address (e.g., 001A2B3C4D5E): " BMC_MAC
read -p "Enter HOST MAC address (e.g., 001A2B3C4D5E): " HOST_MAC

# Convert to lowercase (since dhcpd.leases uses lowercase MACs)
BMC_MAC=$(echo "$BMC_MAC" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')
HOST_MAC=$(echo "$HOST_MAC" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')

echo ""

while true; do
    BMC_IP=$(awk -v mac="$BMC_MAC" '
        /lease/ {ip=$2} 
        /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip} 
        found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -n "$BMC_IP" ]]; then
        echo "IP Address for BMC: $BMC_IP"
	break
    else
        echo "Waiting for BMC IP assignment..."
        sleep 5
    fi
done

echo ""

while ! ipmitool -I lanplus -H $BMC_IP -U admin -P admin chassis power 2>/dev/null; do
    echo "Waiting for valid IPMI response..."
    sleep 5
done
echo "INFO - IPMI response received!"
echo ""

echo "INFO - Changing Boot Device to PXE"
ipmitool -I lanplus -H $BMC_IP -U admin -P admin chassis bootdev pxe options=efiboot,persistent

echo ""

echo "INFO - Powering on system"
ipmitool -I lanplus -H $BMC_IP -U admin -P admin chassis power on

echo ""

while true; do
    HOST_IP=$(awk -v mac="$HOST_MAC" '
        /lease/ {ip=$2} 
        /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip}
        found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -n "$HOST_IP" ]]; then
        echo "IP Address for HOST: $HOST_IP"
        break
    else
        echo "Waiting for Host IP assignment..."
        sleep 5
    fi
done

echo ""

while ! nc -z $HOST_IP 22; do
    echo "Waiting for SSH service up on HOST $HOST_IP..."
    sleep 5
done

echo ""
echo "INFO - Adding SSH host to known_hosts file"
ssh-keyscan -H $HOST_IP >> ~/.ssh/known_hosts #&>/dev/null
echo ""

opensm_is="$(ssh root@$HOST_IP systemctl is-active opensm 2> /dev/null)"
    if [ "$opensm_is" != "active" ]; then
        # Need to load ib_umad ; repeating this is fine, modprobe does the right thing
        ssh root@$HOST_IP modprobe ib_umad
        echo "INFO - ib_umad loaded"
    
        # Attempt to start opensm
        ssh root@$HOST_IP systemctl start opensm
        echo "INFO - Attempting to start opensm (lights on OSFP boards should turn green)"
        sleep 1
   fi

opensm_is="$(ssh root@$HOST_IP systemctl is-active opensm 2> /dev/null)"
    if [ "$opensm_is" == "active" ]; then
        echo -e "\e[32mPASS\e[0m - on starting opensm"

        echo ""
        # ssh root@$HOST_IP
        # # Tests for the CX-7 cards:5CFF35FFC2F3

        mlx_fail_flag=0
        for i in mlx5_0 mlx5_1 mlx5_4 mlx5_5; do
            mlxlink_out_md5_good_case_1="1f5bc9a450ee94fc7d2ee128a012ee10"
	        mlxlink_out_md5_good_case_2="bb01fb610b0751922ea92db9a4421352"
            mlxlink_out_md5=$(ssh root@$HOST_IP "mlxlink -d $i" 2> /dev/null | md5sum | awk '{print $1}')
	    if [[ "${mlxlink_out_md5}" == "${mlxlink_out_md5_good_case_1}" || "${mlxlink_out_md5}" == "${mlxlink_out_md5_good_case_2}" ]]; then
                echo -e "\e[32mPASS\e[0m - mlxlink output correct on $i"
            else
                echo -e "\e[31mFAIL - mlxlink output doesn't exact-match what is expected on $i\e[0m"
                echo ""
                ssh root@$HOST_IP mlxlink -d $i | awk '/^State/{print} /^Troubleshooting Info/,/^$/{if(NF) print}'
                mlx_fail_flag=1
            fi
        done

        echo ""
        if [[ $mlx_fail_flag -eq 1 ]]; then
            
            exit 1;
        fi

        iblink_fail=0
        for i in mlx5_0 mlx5_1 mlx5_4 mlx5_5; do
            ibstat=$(ssh root@$HOST_IP ibstat $i 2> /dev/null | grep State | awk '{print $NF}')
            if [ "${ibstat}" == "Active" ]; then
                echo -e "\e[32mPASS\e[0m - Interface state $ibstat on $i"
            else
                echo -e "\e[31mFAIL, - Interface state not active, it's $ibstat on $i\e[om"
                iblink_fail=1
            fi
        done

        echo ""
        if [[ $iblink_fail -eq 1 ]]; then
           
            exit 1;
        fi

        echo "Transferring ib_write_bw_test.sh to $HOST_IP"
        scp /home/falab/ib_write_bw_test.sh root@$HOST_IP:~ 2> /dev/null

        echo ""
        echo "Running ib_wite_bw command on both OSFP boards"
        ssh root@$HOST_IP '/bin/bash /root/ib_write_bw_test.sh' 2> /dev/null
        performance_0and1=$(ssh root@$HOST_IP grep 65536 /tmp/ib_write_bw_mlx5_0and1.out 2> /dev/null | awk '{print $4}')
        performance_4and5=$(ssh root@$HOST_IP grep 65536 /tmp/ib_write_bw_mlx5_4and5.out 2> /dev/null | awk '{print $4}')

        # Threshold set as 90% of max link speed (400 * 0.9)
        if (($(echo "$performance_0and1 > 360" | bc -l))); then
            echo -e "\e[32mPASS\e[0m - $performance_0and1 Gbps in ib_write_bw for left side OSFP"
        else
            echo -e "\e[31mFAIL - $performance_0and1 Gbps in ib_write_bw for left side OSFP\e[0m"
            exit 1
        fi

        if (($(echo "$performance_4and5 > 360" | bc -l))); then
            echo -e "\e[32mPASS\e[0m - $performance_4and5 Gbps in ib_write_bw for right side OSFP"
        else
            echo -e "\e[31mFAIL - $performance_4and5 Gbps in ib_write_bw for right side OSFP\e[0m"
            exit 1
        fi

        echo ""
        echo -e "\e[32mPASS - IB Loopback Test\e[0m"
        echo ""
    else
        echo -e "\e[31mFAIL - on starting opensm try shutting it down by running the below command inside the PXE env\e[0m"
        echo -e "\e[31msystemctl stop opensm\e[0m"
        echo -e "\e[31mThe server might also not be booted to the PXE image, connect a monitor to double check\e[0m" 
    fi
