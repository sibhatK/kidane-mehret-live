# Network troubleshooting and controlled migration

## Scope and safety

This document records observations supplied from church testing. They have not
been independently reproduced in this repository session. No device or network
configuration was changed for this documentation task. The target subnet below
is a **proposal only**; do not assume the camera migration or removal of the
temporary route has happened.

Do not enable macOS Internet Sharing or IP forwarding. Preserve the camera's
existing HDMI connection to the church television. Make changes only with
physical access, an authorized operator, a maintenance window, and a tested
rollback path.

## Observed configuration

| Device/interface     | Observed address | Observed mask / role                         |
| -------------------- | ---------------- | -------------------------------------------- |
| Mac Wi-Fi (`en1`)    | `192.168.1.206`  | Church LAN; working internet through Wi-Fi   |
| Mac Ethernet (`en0`) | `192.168.1.10`   | Camera Ethernet; observed mask `255.255.0.0` |
| PTZOptics Move 4K    | `192.168.1.76`   | Fixed address; mask `255.255.255.0`          |
| AT&T router          | `192.168.1.254`  | Church Wi-Fi/LAN router                      |

## Tests and results

| Test                                          | Observed result                                                                 | What it establishes                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Physical Ethernet connection                  | Link established                                                                | Cable/link is present, not that IP communication works                |
| Camera web administration with Wi-Fi disabled | Reached at `http://192.168.1.76`                                                | Camera is reachable in that test condition                            |
| Church Wi-Fi with Ethernet disabled           | Internet works                                                                  | Wi-Fi internet is independently available                             |
| Both interfaces enabled                       | Camera unreachable                                                              | Dual-interface configuration remains a blocker                        |
| Original route lookup for camera              | macOS selected Wi-Fi (`en1`)                                                    | Route selection was not favoring the camera Ethernet path             |
| Temporary host route to Ethernet              | Interface selection changed; camera still unreachable                           | Route selection alone did not restore communication                   |
| Ping with both interfaces enabled             | 100% packet loss                                                                | No successful ICMP replies in that test; not a diagnosis of the cause |
| ARP output                                    | Permanent entry associated with Mac Ethernet MAC, not verified camera discovery | Does not establish that the camera was discovered at that MAC         |
| OBS NDI source discovery                      | A source advertised as PTZOPTICS at `192.168.1.76`                              | Discovery only; live NDI video decode was **not verified**            |

The Mac's Ethernet mask (`/16`) and camera's mask (`/24`) differ. Both addresses
also fall within the observed Wi-Fi `192.168.1.0/24` network. This overlap and
mask mismatch are plausible contributors to route ambiguity, but the tests do
not prove a root cause. The temporary route's removal has not been independently
confirmed.

## Proposed target — not implemented

| Device/interface | Proposed configuration                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| Mac Wi-Fi        | Retain DHCP on church network                                                          |
| Mac Ethernet     | `192.168.100.10/24`; no Ethernet gateway required on the Mac                           |
| Camera           | `192.168.100.76/24`; gateway value must be confirmed as compatible by the manufacturer |

The camera configuration interface rejected or highlighted some attempted
input changes. Confirm firmware-specific rules, gateway requirements, and the
ability to recover camera access before planning a migration. These target
values are not current configuration.

## Controlled maintenance procedure

1. **Prepare and back up.** Schedule downtime; ensure local administrator
   access, physical access, and a second operator if available. Record/export
   current Mac Wi-Fi/Ethernet configuration, camera address/mask/gateway, route
   state, router values, camera firmware, and the HDMI/PoE cabling. Save
   screenshots or vendor-supported configuration backups without recording
   passwords or stream keys in this repository.
2. **Check compatibility.** Confirm the proposed camera subnet does not overlap
   the church LAN, VPN, or another interface; confirm the camera supports the
   proposed static address/mask and an appropriate gateway value. Confirm the
   Mac can keep Wi-Fi DHCP and use Ethernet only for the camera, with no
   Ethernet default gateway.
3. **Plan access and rollback.** Confirm how to restore the camera if its web
   page is lost (local direct connection, known address, vendor reset/recovery
   guidance). Preserve the current HDMI/PoE and Wi-Fi paths. Verify the
   temporary host route's exact state and plan to remove only the known test
   route; its removal is not yet confirmed.
4. **Apply in a controlled sequence.** With local access available, configure
   the Mac Ethernet and camera for the approved target values. Keep Wi-Fi on
   DHCP. Do not change router settings, enable Internet Sharing/IP forwarding,
   or expose services to the public internet. Follow manufacturer guidance for
   camera gateway configuration.
5. **Validate both paths.** With both interfaces enabled, verify route selection
   to the camera uses Ethernet, reach the camera administration page, and
   identify the camera's actual MAC from a fresh neighbor/ARP observation.
   Confirm church internet still uses Wi-Fi; verify the camera's HDMI picture
   on the church television and PoE operation remain unchanged. Then test the
   selected video protocol in OBS for actual decoded frames—not just source
   discovery. Record results and configuration.
6. **Stop if any check fails.** Do not proceed to PTZ commands or a stream test
   until the network, video, and audio paths are confirmed. Follow rollback
   below and document the observed failure without guessing its cause.

## Rollback

Use the recorded baseline and manufacturer guidance to restore the Mac Ethernet
and camera to their previous values, retain Wi-Fi DHCP, and restore the
television/PoE cabling. Remove the temporary test host route only after
identifying it precisely, then verify the route table no longer contains that
test entry. Confirm camera administration access in the known baseline
condition and church Wi-Fi internet access. If the camera cannot be recovered,
stop and use the manufacturer's local recovery/support procedure; do not
attempt a remote workaround or broad network changes.

## Validation checklist

- [ ] Backups and exact current values recorded; physical rollback available.
- [ ] Camera subnet and gateway compatibility confirmed for model/firmware.
- [ ] Wi-Fi remains on DHCP and reaches church internet.
- [ ] Ethernet has no unintended default gateway; camera route selects Ethernet.
- [ ] Fresh camera MAC discovery is verified, not inferred from a permanent entry.
- [ ] Camera admin page is accessible with both interfaces enabled.
- [ ] Existing PoE and HDMI-to-TV path remain functional.
- [ ] Actual camera video decodes in OBS; NDI discovery alone is insufficient.
- [ ] Mixer-to-Mac audio path and clean audio are separately confirmed.
- [ ] Temporary test route removal is verified.
- [ ] Internet Sharing/IP forwarding remain off; no public exposure is introduced.
- [ ] Results, deviations, and any rollback are recorded for M0 sign-off.
