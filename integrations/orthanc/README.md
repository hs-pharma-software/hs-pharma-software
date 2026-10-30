# Connecting radiology machines (DICOM)

Most X-Ray, CT, MRI and ultrasound machines use only the DICOM network protocol and cannot call a web address. Orthanc, a free PACS server, sits between them and the hospital system:

```
machine ──DICOM worklist (C-FIND)──▶ Orthanc ──HTTPS──▶ /api/dicom/worklist
machine ──DICOM images (C-STORE)───▶ Orthanc ──HTTPS──▶ /api/dicom/studies
```

## 1. In the hospital system

1. **Radiology › Modalities:** load the standard list, or add your own modalities.
2. **Radiology › Machines:** add each machine:
   - give it the **AE Title** it has in its own DICOM settings, for example `XRAY01`;
   - click **Create key** and copy the key. It is shown only once.
3. **Radiology › PACS / Orthanc:** enter:
   - the Orthanc address;
   - the viewer address, for example `https://pacs.example.pk/stone-webviewer/index.html?study={StudyInstanceUID}`;
   - Orthanc's AE Title, host and port.

## 2. Orthanc (on a computer in the radiology department)

1. Install Orthanc with the **Python plugin** and the **Stone Web Viewer** plugin.
2. Copy `hms_bridge.py` next to Orthanc's configuration file.
3. Merge `orthanc.example.json` into Orthanc's configuration:
   - `HmsBridge.ApiBase` is the address of the web version.
   - `HmsBridge.Machines` maps each AE Title to that machine's key.
   - `DicomModalities` lists each machine (AE Title, IP address, port).
4. Restart Orthanc. Its log should show `HmsBridge: connected to … for N machine(s)`.

Keep the configuration file readable only by the Orthanc service, because it holds the machine keys.

## 3. On each machine (done by the vendor engineer or the biomedical team)

- **Worklist server (MWL):** the Orthanc computer's IP address, port `4242`, AE Title `ORTHANC`.
- **Storage server (PACS):** the same three values.
- **The machine's own AE Title:** the one entered on Radiology › Machines.

## How it works

When a machine queries its worklist, it shows the patients waiting for it:

- **Which orders are listed:** paid orders of the machine's modality, in queue order (STAT first).
- **Accession Number:** the order number (RAD-…).
- **Patient ID:** the MR number.

The technologist selects the patient on the console instead of typing the name.

When the images reach Orthanc, the order records the Study Instance UID and the number of series and images. The **View images** button on the Technologist and Reporting screens then opens the study in the viewer.

The examination is completed by the technologist in the portal, after the consent and identity checks. The machine never completes it.

## API reference

Every request sends the machine key in the header `Authorization: Bearer hmsk_…`. You can use `X-Api-Key: hmsk_…` instead.

| Request | What it does |
|---|---|
| `GET /api/dicom/ping` | Checks the key. Returns the machine code, name, modality and AE Title. |
| `GET /api/dicom/worklist` | The machine's worklist as DICOM JSON (`application/dicom+json`). Add `?format=keywords` to get DICOM keywords instead, which is the format Orthanc uses. |
| `POST /api/dicom/mpps` | `{ "accessionNumber", "status": "IN PROGRESS" \| "COMPLETED" \| "DISCONTINUED", "studyInstanceUid"?, "seriesCount"?, "imagesCount"? }`. Use it from a gateway that receives the machine's MPPS messages. |
| `POST /api/dicom/studies` | `{ "accessionNumber"?, "studyInstanceUid", "seriesCount"?, "imagesCount"? }`. Reports that images were stored. |

Errors and what they mean:

- **401:** missing or wrong key.
- **403:** the machine is set to Maintenance or Retired.
- **404:** no order matches.
- **409:** the order is cancelled or reported, its fee is not paid, or it is being examined on another machine.

Test a key from any computer:

```
curl -H "Authorization: Bearer hmsk_..." https://your-hospital-website/api/dicom/ping
```

The machine API runs on the web version only (Vercel). The desktop app syncs the results from the shared database.
