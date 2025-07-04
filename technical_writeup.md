# L10 Test Process Overview

The original method for running the L10 test was time-consuming and error-prone, requiring ~2 hours to complete and 20–30 minutes of active operator time. To improve efficiency and eliminates user error, a new automated process was developed, currently in use at Franklin and TSS, which reduces total test time to ~1 hour 35 minutes and minimizes operator involvement.

Below is a detailed comparison of the two methods.

---

## 🔷 Old L10 Test Method

**Summary:** Manual setup, high operator involvement, prone to error.

### Steps
1. Replace one of the system’s NVMe drives with one containing the L10 image.
2. Connect busbar power and coolant to the system.
3. Wait ~2 minutes for the BMC to boot.
4. Connect a micro-USB cable to the BIOS serial port and open TeraTerm on a host machine.
5. Power on the system using the front power button.
6. Monitor BIOS POST via serial and press `F2` to enter BIOS setup.
7. Change the boot drive to the NVMe with the L10 image.
8. Save BIOS settings and continue boot.
9. Log in to the L10 OS and run the appropriate command for the Gaines 1.5 configuration. For configuration 4, run:

    ```bash
    sudo ./partnerdiag --mfg \
      --run_spec=spec_gb200_nvl_2_4_board_pc_partner_mfg_0021_xAI_gaines1_5_config4.json \
      --run_on_error --no_bmc \
      --skip_tests=IbStressCables,Bf3PcieInterfaceTraffic,CxeyegradeStart,IbStressBf3PhyLoopback,IbStressBf3Loopout,IbStressCx7PhyLoopback,IbStressLoopout400G_8X,IbStressLoopout400G_4X,CxeyegradeStop,WisSsdPcieProperties_E1S
    ```

10. Wait ~1.5 hours for the test to complete.
11. At completion:
    - If **PASS**, take a screenshot of the log and add it to the daily report.
    - If **FAIL**, collect logs and email them to WHQ:
        1. Insert a USB stick into the system.
        2. Mount the USB via the command line.
        3. Copy the log files.
        4. Unmount the USB stick.

### Drawbacks
- Requires constant operator attention and interaction.
- Prone to user error; mistakes often require restarting the test from the beginning.
- Inefficient use of operator time.

---

## 🔷 New Automated L10 Test Method

**Summary:** Streamlined, automated, minimal operator involvement.

### Steps
1. Connect busbar power and coolant to the system.
2. Connect both the HOST and BMC 1G NICs to the L10 validation network.
3. Run the `l10_test.sh` automated script.
4. Scan the system’s BMC MAC address, HOST MAC address, and Service Tag (all found on the system label).

Done - The automated script handles booting, OS deployment, running the test, log retention, and error reporting.  
If issues arise, the script provides clear guidance on possible causes and corrective actions.

---

## 🔷 Why Use the Automated Method?

✅ Reduces operator time and workload  
✅ Faster test completion (~1:35)  
✅ Minimizes errors and restarts  
✅ Simplifies log collection and reporting  

The automated method is now the preferred approach for running L10 tests, ensuring greater efficiency, reliability, and ease of use.

---

# Technical Details

![Automated L10 Test Process Diagram](https://github.com/giovannirleon/wistronlabs/blob/main/system_diagram.jpg)

Understanding how the automated process works is key to verifying it’s functioning properly. Below is a step-by-step breakdown of what the script does behind the scenes:

1. **Check BMC DHCP Lease**  
   When the script starts, it polls the DHCP server to see if an IP address has been assigned to the system’s **BMC MAC address**.

2. **BMC Powers On and Requests IP**  
   As soon as the system is powered on with all Ethernet cables connected, the BMC automatically powers up and requests an IP address from the DHCP server.

3. **Verify BMC Response via IPMI**  
   Once the script detects a valid DHCP lease for the BMC, it queries the BMC at that IP until it receives a valid IPMI response.

4. **Configure PXE Boot and Power On Host**  
   After confirming BMC communication, the script sets the boot device to PXE and sends a power-on command to the host system via IPMI.

5. **Check HOST DHCP Lease**  
   The script then monitors the DHCP server to see if the **HOST MAC address** has been assigned an IP.

6. **PXE Boot and OS Load**  
   Once the host begins booting via PXE, it requests an IP from DHCP, downloads the PXE image of the L10 OS into memory, and boots into it.

7. **Verify HOST OS Readiness via SSH**  
   The script continuously checks if port 22 (SSH) is open on the host, indicating that the L10 OS is fully booted and ready.

8. **Run L10 Test**  
   Once SSH access is confirmed, the script connects to the host and runs the L10 test program, using the appropriate modules for the system configuration.

9. **Collect Logs and Shut Down**  
   The L10 test runs for approximately 1.5 hours. When complete, the script retrieves the logs via SCP, saving them in a folder named after the system’s service tag, then powers off the system.

