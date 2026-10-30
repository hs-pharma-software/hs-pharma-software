"""Bridge between Orthanc and the hospital system's DICOM API.

Load it with Orthanc's Python plugin ("PythonScript" in orthanc.json). It
does two things:

1. Modality Worklist: when a machine asks Orthanc for its worklist (DICOM
   C-FIND), the bridge fetches that machine's waiting patients from
   /api/dicom/worklist with the machine's key and answers with them.
2. Images received: when a study in Orthanc becomes stable (all images
   arrived), the bridge tells /api/dicom/studies, so the order shows its
   images and "View images" opens them.

Settings go in orthanc.json, section "HmsBridge":

    "HmsBridge": {
      "ApiBase": "https://your-hospital-website",
      "Machines": { "XRAY01": "hmsk_...", "CT01": "hmsk_..." },
      "DefaultMachine": "XRAY01",
      "TimeoutSeconds": 10
    }

"Machines" maps each machine's AE Title (as set on the machine and on
Radiology > Machines) to the key created for it there. Keep orthanc.json
readable only by the Orthanc service account: the keys are secrets.
"""

import json
import threading
import urllib.error
import urllib.request

import orthanc

_config = json.loads(orthanc.GetConfiguration()).get("HmsBridge", {})
API_BASE = str(_config.get("ApiBase", "")).rstrip("/")
MACHINES = {str(k).strip().upper(): str(v) for k, v in _config.get("Machines", {}).items()}
DEFAULT_MACHINE = str(_config.get("DefaultMachine", "")).strip().upper()
TIMEOUT = float(_config.get("TimeoutSeconds", 10))


def _log_warning(message):
    orthanc.LogWarning("HmsBridge: " + message)


def _key_for(aet):
    aet = (aet or "").strip().upper()
    return MACHINES.get(aet) or MACHINES.get(DEFAULT_MACHINE)


def _call(method, path, key, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API_BASE + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return json.loads(res.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        _log_warning("%s %s answered %s: %s" % (method, path, e.code, detail))
    except Exception as e:  # network down, timeout, bad JSON
        _log_warning("%s %s failed: %s" % (method, path, e))
    return None


# ── Modality Worklist (C-FIND) ────────────────────────────────────────────

def on_worklist(answers, query, issuer_aet, called_aet):
    key = _key_for(issuer_aet)
    if not key:
        _log_warning("worklist asked by unknown AE Title %r; add it to HmsBridge.Machines" % issuer_aet)
        return
    items = _call("GET", "/api/dicom/worklist?format=keywords", key) or []
    for item in items:
        try:
            dicom = orthanc.CreateDicom(json.dumps(item), None, orthanc.CreateDicomFlags.NONE)
        except Exception as e:
            _log_warning("could not build worklist item %s: %s" % (item.get("AccessionNumber"), e))
            continue
        if query.WorklistIsMatch(dicom):
            answers.WorklistAddAnswer(query, dicom)


# ── Images received ───────────────────────────────────────────────────────

def _report_study(study_id):
    study = json.loads(orthanc.RestApiGet("/studies/%s" % study_id))
    tags = study.get("MainDicomTags", {})
    instances = json.loads(orthanc.RestApiGet("/studies/%s/instances" % study_id))
    aet = ""
    if instances:
        try:
            aet = orthanc.RestApiGet("/instances/%s/metadata/RemoteAET" % instances[0]["ID"]).decode("utf-8")
        except Exception:
            aet = ""
    key = _key_for(aet)
    if not key:
        _log_warning("study %s came from unknown AE Title %r; add it to HmsBridge.Machines" % (study_id, aet))
        return
    _call("POST", "/api/dicom/studies", key, {
        "accessionNumber": tags.get("AccessionNumber", ""),
        "studyInstanceUid": tags.get("StudyInstanceUID", ""),
        "seriesCount": len(study.get("Series", [])),
        "imagesCount": len(instances),
    })


def on_change(change_type, level, resource_id):
    if change_type == orthanc.ChangeType.STABLE_STUDY:
        # Off Orthanc's own thread: the HTTPS call must not hold up storage.
        threading.Thread(target=_report_study, args=(resource_id,), daemon=True).start()


if not API_BASE or not MACHINES:
    _log_warning("set HmsBridge.ApiBase and HmsBridge.Machines in orthanc.json; the bridge is off")
else:
    orthanc.RegisterWorklistCallback(on_worklist)
    orthanc.RegisterOnChangeCallback(on_change)
    orthanc.LogWarning("HmsBridge: connected to %s for %d machine(s)" % (API_BASE, len(MACHINES)))
