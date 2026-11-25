# Connecting radiology machines (DICOM): X-Ray, ultrasound, CT, MRI

Radiology machines speak DICOM, not web addresses. **Orthanc**, a free PACS server, runs on one computer in the radiology department and sits between the machines and MAVIN:

```
machine ──DICOM worklist (C-FIND)──▶ Orthanc + hms_bridge.py ──HTTPS──▶ www.mavin.pk/api/dicom/worklist/
machine ──DICOM images (C-STORE)───▶ Orthanc + hms_bridge.py ──HTTPS──▶ www.mavin.pk/api/dicom/studies/
staff browser ──"View images"──────▶ Orthanc's Stone Web Viewer (on the hospital network)
```

- **Worklist:** the technologist picks the patient on the machine's screen instead of typing the name, MR number and accession number.
- **Images:** the images go to Orthanc (the PACS). The order in MAVIN records them, and **View images** opens them on the Technologist and Reporting screens.
- **Internet drops:** the machines keep working.
  - The bridge answers the worklist with the last list it fetched.
  - "Images received" reports wait in a queue on the Orthanc computer, and go when the internet returns.

## What you need

| Item | Notes |
|---|---|
| A PC for Orthanc | Windows 10/11 or Ubuntu, 8 GB RAM, a large disk (about 30 MB per CT, 10–20 MB per X-ray, 1–5 MB per ultrasound study). It stays on, on the same network (LAN) as the machines, with a **fixed IP**, for example 192.168.1.20. |
| The machines | Need DICOM **Storage (C-STORE)**, and ideally **Modality Worklist (MWL)**. Most digital X-ray (CR/DR) and modern ultrasound machines have both. On some ultrasound machines, MWL is a paid licence option: ask the vendor. |
| Internet on the Orthanc PC | To reach www.mavin.pk. |
| A Hospital or Radiology Centre account | Radiology Centres need the Elite plan for the DICOM connection. |

## 1. In MAVIN

1. **Radiology › Modalities:** load the standard list (CR/DX X-Ray, US Ultrasound, CT, MR…).
2. **Radiology › Machines:** add each machine.
   - **Modality:** for example X-Ray or Ultrasound.
   - **AE Title:** the name the machine has in its own DICOM settings, up to 16 capital letters or digits, for example `XRAY01` or `US01`. Ask the engineer, or choose one and set the same on the machine.
   - Click **Create key**. The window shows the key **once**, plus the exact line to paste into Orthanc's settings. Copy it.
3. **Radiology › PACS / Orthanc:**
   - **Orthanc web address:** `http://192.168.1.20:8042` (the Orthanc PC on the hospital network).
   - **Viewer address:** leave blank to use Orthanc's Stone Web Viewer.
   - **AE Title:** `ORTHANC`.
   - **DICOM host:** `192.168.1.20`.
   - **Port:** `4242`.

## 2. Install Orthanc

### Windows

1. Download the **Orthanc Windows installer** from orthanc.uclouvain.be (Downloads › Windows, 64-bit). Install it with its plugins, including **Python** and **Stone Web Viewer**.
2. The Python plugin needs the **matching version of Python** installed for all users. The installer's plugin list says which version, for example Python 3.11 64-bit. Install that version from python.org, ticking "Install for all users" and "Add to PATH".
3. Copy `hms_bridge.py` into Orthanc's **Configuration** folder. By default this is `C:\Program Files\Orthanc Server\Configuration\`.
4. Create the folder `C:\OrthancState`, then set up two files in the Configuration folder.

   The Windows installer already has an `orthanc.json` there. **Don't copy the whole example into a second file.** Orthanc reads every `.json` in the folder, and a setting that appears twice stops it from starting.

   - **`mavin.json` (new):** only the bridge settings:
     ```json
     {
       "PythonScript": "C:\\Program Files\\Orthanc Server\\Configuration\\hms_bridge.py",
       "HmsBridge": {
         "ApiBase": "https://www.mavin.pk",
         "StateDirectory": "C:\\OrthancState",
         "Machines": {
           "XRAY01": "hmsk_… (the line copied from Radiology › Machines)"
         }
       }
     }
     ```
   - **`orthanc.json` (existing):** open it in Notepad as administrator. Use Ctrl+F to find each of these settings and change its value; don't add new lines:
     - `"RemoteAccessAllowed": true`
     - `"AuthenticationEnabled": true`
     - `"RegisteredUsers": { "admin": "a-strong-password" }`
     - `"DicomModalities"`: one line per machine, for example `"XRAY01": ["XRAY01", "192.168.1.31", 104]` (AE Title, IP address, DICOM port).
     - `"DicomAlwaysAllowStore": true` and `"DicomCheckCalledAet": false`.
5. Start Orthanc with the folder, not one file:
   - **As a service:** **Services** (`services.msc`) › **Orthanc** › Restart.
   - **By hand:** `.\Orthanc.exe "C:\Program Files\Orthanc Server\Configuration"`.
6. Allow ports **4242** (DICOM) and **8042** (web) in Windows Firewall, for the hospital network only.

### Ubuntu

```
sudo apt install orthanc orthanc-python orthanc-stone-webviewer
sudo cp hms_bridge.py /etc/orthanc/
sudo cp orthanc.example.json /etc/orthanc/mavin.json   # then edit it as in step 4 above
sudo systemctl restart orthanc
```

On Ubuntu, keep `"Plugins": ["/usr/share/orthanc/plugins"]` and set `"PythonScript": "/etc/orthanc/hms_bridge.py"`.

### Check it started

Open Orthanc's log. On Windows it's in `C:\Program Files\Orthanc Server\Logs\`; on Ubuntu run `journalctl -u orthanc`. You should see:

```
HmsBridge: connected to https://www.mavin.pk for 2 machine(s)
HmsBridge: XRAY01 key works (machine X-Ray Room)
```

If a key line is missing, a warning nearby says why, for example "401 … key".

Keep the settings file readable only by the Orthanc service. It holds the machine keys.

## 3. On each machine (vendor engineer or biomedical team)

These are the DICOM / network settings on the machine's console:

| Setting | Value |
|---|---|
| The machine's own AE Title | as entered on Radiology › Machines, for example `XRAY01` |
| Machine IP | a fixed IP on the hospital network, for example `192.168.1.31` |
| **Worklist (MWL) server** | AE Title `ORTHANC`, IP `192.168.1.20`, port `4242` |
| **Storage (PACS / C-STORE) server** | AE Title `ORTHANC`, IP `192.168.1.20`, port `4242` |
| Send images automatically | On (often "Auto send", "Auto store" or "Send after exam end") |

Then use the machine's **Verify / Echo** button on both servers. It should succeed.

- **Ultrasound:** set it to send the saved images (and clips, if wanted) at the end of the exam. The measurements and report are still entered in MAVIN: the structured ultrasound report with its editable preview.
- **CR X-ray (cassette reader):** the same settings go on the **CR reader** workstation, not on the X-ray tube.
- **No DICOM on the machine:** images can't be linked automatically. Use the machine's print or USB export, and attach or record the result in MAVIN by hand.

## 4. A first test

1. Book a patient for an X-ray or ultrasound in MAVIN and collect the fee. Only paid orders appear on the worklist.
2. On the machine, open the worklist (often "Worklist", "Query" or "Patient list" › Refresh). The patient appears with the MR number and the accession number (the order number).
3. Take the images and send them. In Orthanc's web page (`http://192.168.1.20:8042`) the study appears.
4. In MAVIN, **Radiology › Technologist / Reporting** shows the images received, and **View images** opens them.

## Troubleshooting

| What happens | Check |
|---|---|
| The worklist is empty on the machine | Is the order paid, of the machine's modality, and not already reported? Is the machine's AE Title in `HmsBridge.Machines` and `DicomModalities`? The Orthanc log says "worklist asked by unknown AE Title" when it is not. |
| The Echo / Verify fails | IP, port 4242 and AE Title `ORTHANC`; the Windows Firewall; both on the same network. |
| Images are in Orthanc but not in MAVIN | The Orthanc log: a "queued" message means no internet (it is sent later). "404" means the accession number on the images does not match an order: the patient was typed by hand, not picked from the worklist. |
| "401" in the log | Wrong or replaced key: create a new key on Radiology › Machines and paste it into the settings. |
| "403" | The machine is set to Maintenance or Retired on Radiology › Machines. |
| View images does not open | The viewer only works on the hospital network, or through a VPN, because Orthanc is on that network. |

## API reference (for gateways other than Orthanc)

Every request sends the machine key in the header `Authorization: Bearer hmsk_…`. `X-Api-Key: hmsk_…` also works. **The addresses end with `/`**: without it, the site answers with a redirect, which most DICOM gateways don't follow for POST.

| Request | What it does |
|---|---|
| `GET /api/dicom/ping/` | Checks the key. Returns the machine code, name, modality and AE Title. |
| `GET /api/dicom/worklist/` | The machine's worklist as DICOM JSON (`application/dicom+json`). Add `?format=keywords` for DICOM keywords instead, which is Orthanc's format. |
| `POST /api/dicom/mpps/` | `{ "accessionNumber", "status": "IN PROGRESS" \| "COMPLETED" \| "DISCONTINUED", "studyInstanceUid"?, "seriesCount"?, "imagesCount"? }`. From a gateway that receives the machine's MPPS messages. Orthanc itself doesn't receive MPPS. |
| `POST /api/dicom/studies/` | `{ "accessionNumber"?, "studyInstanceUid", "seriesCount"?, "imagesCount"? }`. Reports that images were stored. |

Errors:
- **401:** missing or wrong key.
- **403:** the machine is set to Maintenance or Retired.
- **404:** no order matches.
- **409:** the order is cancelled or reported, its fee is not paid, or it is being examined on another machine.

```
curl -H "Authorization: Bearer hmsk_..." https://www.mavin.pk/api/dicom/ping/
```

The machine API runs on the web version only (www.mavin.pk). The desktop app syncs the results from the shared database.
