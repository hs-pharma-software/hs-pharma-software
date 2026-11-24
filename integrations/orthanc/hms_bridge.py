"""Bridge between Orthanc and the hospital system's DICOM API (MAVIN.pk).

Load it with Orthanc's Python plugin ("PythonScript" in orthanc.json). It
does two things:

1. Modality Worklist: when a machine asks Orthanc for its worklist (DICOM
   C-FIND), the bridge fetches that machine's waiting patients from
   /api/dicom/worklist/ with the machine's key and answers with them. The
   last list is kept on disk: if the internet is down, the machine still
   gets the patients that were waiting.
2. Images received: when a study in Orthanc becomes stable (all images
   arrived), the bridge tells /api/dicom/studies/, so the order shows its
   images and "View images" opens them. If the internet is down, the report
   waits in a queue on disk and is sent again every minute until it goes.

Settings go in orthanc.json, section "HmsBridge":

    "HmsBridge": {
      "ApiBase": "https://www.mavin.pk",
      "Machines": { "XRAY01": "hmsk_...", "US01": "hmsk_..." },
      "DefaultMachine": "",
      "TimeoutSeconds": 10,
      "StateDirectory": ""
    }

"Machines" maps each machine's AE Title (as set on the machine and on
Radiology > Machines) to the key created for it there. "StateDirectory" is
where the queue and the worklist copy are kept (blank: next to this script).
Keep orthanc.json readable only by the Orthanc service account: the keys
are secrets. Works with Python 3.6 and later.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request

import orthanc

_config = json.loads(orthanc.GetConfiguration()).get("HmsBridge", {})
# The site answers its API only at addresses ending in "/" (others redirect, and a redirected POST is not followed).
API_BASE = str(_config.get("ApiBase", "")).strip().rstrip("/")
MACHINES = {str(k).strip().upper(): str(v).strip() for k, v in _config.get("Machines", {}).items()}
DEFAULT_MACHINE = str(_config.get("DefaultMachine", "")).strip().upper()
TIMEOUT = float(_config.get("TimeoutSeconds", 10))
STATE_DIR = str(_config.get("StateDirectory", "")).strip() or os.path.dirname(os.path.abspath(__file__))
QUEUE_FILE = os.path.join(STATE_DIR, "hms_bridge_queue.json")
RETRY_SECONDS = 60

_lock = threading.Lock()


def _log_warning(message):
    orthanc.LogWarning("HmsBridge: " + message)


def _key_for(aet):
    aet = (aet or "").strip().upper()
    return MACHINES.get(aet) or MACHINES.get(DEFAULT_MACHINE)


def _call(method, path, key, body=None):
    """One API call. Returns (ok, answer); ok is False when it should be tried again later."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API_BASE + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "MAVIN-Orthanc-Bridge/2")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return True, json.loads(res.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        _log_warning("%s %s answered %s: %s" % (method, path, e.code, detail))
        # 4xx: the request itself is wrong (key, unknown order...): sending it again will not help. 5xx: try later.
        return (e.code < 500), None
    except Exception as e:  # network down, timeout, bad JSON
        _log_warning("%s %s failed: %s" % (method, path, e))
        return False, None


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path, value):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f)
    os.replace(tmp, path)


# ── Modality Worklist (C-FIND) ────────────────────────────────────────────

def _worklist_copy(aet):
    return os.path.join(STATE_DIR, "hms_worklist_%s.json" % "".join(c for c in aet.upper() if c.isalnum() or c in "-_"))


def on_worklist(answers, query, issuer_aet, called_aet):
    key = _key_for(issuer_aet)
    if not key:
        _log_warning("worklist asked by unknown AE Title %r; add it to HmsBridge.Machines" % issuer_aet)
        return
    ok, items = _call("GET", "/api/dicom/worklist/?format=keywords", key)
    copy = _worklist_copy(issuer_aet or DEFAULT_MACHINE)
    if ok and isinstance(items, list):
        try:
            _write_json(copy, items)
        except Exception as e:
            _log_warning("could not keep the worklist copy: %s" % e)
    else:
        items = _read_json(copy, [])
        if items:
            _log_warning("no connection: answering %s with the last worklist (%d patients)" % (issuer_aet, len(items)))
    for item in items or []:
        try:
            dicom = orthanc.CreateDicom(json.dumps(item), None, orthanc.CreateDicomFlags.NONE)
        except Exception as e:
            _log_warning("could not build worklist item %s: %s" % (item.get("AccessionNumber"), e))
            continue
        if query.WorklistIsMatch(dicom):
            answers.WorklistAddAnswer(query, dicom)


# ── Images received (with a queue that survives the internet going down) ─

def _study_report(study_id):
    """What /api/dicom/studies/ needs about a study, and the machine (AE Title) it came from."""
    study = json.loads(orthanc.RestApiGet("/studies/%s" % study_id))
    tags = study.get("MainDicomTags", {})
    instances = json.loads(orthanc.RestApiGet("/studies/%s/instances" % study_id))
    aet = ""
    if instances:
        try:
            aet = orthanc.RestApiGet("/instances/%s/metadata/RemoteAET" % instances[0]["ID"]).decode("utf-8")
        except Exception:
            aet = ""
    return aet, {
        "accessionNumber": tags.get("AccessionNumber", ""),
        "studyInstanceUid": tags.get("StudyInstanceUID", ""),
        "seriesCount": len(study.get("Series", [])),
        "imagesCount": len(instances),
    }


def _send(entry):
    key = _key_for(entry.get("aet", ""))
    if not key:
        _log_warning("study %s came from unknown AE Title %r; add it to HmsBridge.Machines" % (entry["body"].get("studyInstanceUid"), entry.get("aet")))
        return True  # nothing to retry with
    ok, _ = _call("POST", "/api/dicom/studies/", key, entry["body"])
    return ok


def _enqueue(entry):
    with _lock:
        queue = _read_json(QUEUE_FILE, [])
        queue = [q for q in queue if q.get("studyId") != entry["studyId"]] + [entry]
        _write_json(QUEUE_FILE, queue)


def _report_study(study_id):
    try:
        aet, body = _study_report(study_id)
    except Exception as e:
        _log_warning("could not read study %s: %s" % (study_id, e))
        return
    entry = {"studyId": study_id, "aet": aet, "body": body, "since": time.time()}
    if not _send(entry):
        _enqueue(entry)
        _log_warning("study %s queued: it is sent when the connection returns" % (body.get("accessionNumber") or study_id))


def _retry_loop():
    while True:
        time.sleep(RETRY_SECONDS)
        with _lock:
            queue = _read_json(QUEUE_FILE, [])
        if not queue:
            continue
        left = [q for q in queue if not _send(q)]
        sent = {q["studyId"] for q in queue} - {q["studyId"] for q in left}
        with _lock:
            # Reports queued meanwhile stay in the queue.
            now = _read_json(QUEUE_FILE, [])
            _write_json(QUEUE_FILE, [q for q in now if q["studyId"] not in sent])
        if sent:
            orthanc.LogWarning("HmsBridge: sent %d queued study report(s); %d waiting" % (len(sent), len(left)))


def on_change(change_type, level, resource_id):
    if change_type == orthanc.ChangeType.STABLE_STUDY:
        # Off Orthanc's own thread: the HTTPS call must not hold up storage.
        threading.Thread(target=_report_study, args=(resource_id,), daemon=True).start()


if not API_BASE or not MACHINES:
    _log_warning("set HmsBridge.ApiBase and HmsBridge.Machines in orthanc.json; the bridge is off")
else:
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
    except Exception as e:
        _log_warning("cannot use StateDirectory %s: %s" % (STATE_DIR, e))
    orthanc.RegisterWorklistCallback(on_worklist)
    orthanc.RegisterOnChangeCallback(on_change)
    threading.Thread(target=_retry_loop, daemon=True).start()

    def _check_keys():
        # Off the start-up thread: a slow connection must not hold up Orthanc.
        for aet, key in MACHINES.items():
            ok, answer = _call("GET", "/api/dicom/ping/", key)
            if ok and answer:
                orthanc.LogWarning("HmsBridge: %s key works (machine %s)" % (aet, (answer.get("machine") or {}).get("name", "?")))

    threading.Thread(target=_check_keys, daemon=True).start()
    orthanc.LogWarning("HmsBridge: connected to %s for %d machine(s)" % (API_BASE, len(MACHINES)))
