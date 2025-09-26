import json

# ------------- Konfiguration (Entities) -----------------
ENT_AT       = "sensor.samsung_ehssentinel_outdoorouttemp"
ENT_X_MIN    = "number.samsung_ehssentinel_infsv2011"
ENT_X_MAX    = "number.samsung_ehssentinel_infsv2012"
ENT_VL_MIN   = "number.samsung_ehssentinel_infsv2021"
ENT_VL_MAX   = "number.samsung_ehssentinel_infsv2022"
ENT_SEG_JSON = "input_text.heizkurve_segments"
ENT_DELTA    = "input_number.heizkurve_delta"
ENT_DBG_FLAG = True # optional

# Debug-Ausgabe zusätzlich als Notification?
DEBUG_TO_NOTIFICATION = True   # kannst du auf False setzen

# ------------- Hilfsfunktionen --------------------------
def _safe_float(val, default=0.0):
    try:
        return float(val)
    except Exception:
        return float(default)

def _round05(x: float) -> float:
    return round(x * 2.0) / 2.0

def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))

def _parse_points(raw: str):
    pts = []
    try:
        obj = json.loads(raw or "")
        pts = obj.get("points", [])
    except Exception as e:
        log.warning(f"[Heizkurve] JSON parse failed: {e}; raw_len={len(raw or '')}")
        pts = []
    if not isinstance(pts, list) or len(pts) < 2:
        pts = [{"t": 0, "off": 0}, {"t": 1, "off": 0}]
    # Normieren & sortieren
    norm = []
    for p in pts:
        try:
            t = float(p.get("t", 0))
            off = float(p.get("off", 0))
        except Exception:
            continue
        t = _clamp01(t)
        # Offsets bleiben wie gespeichert; Rundung (0.5er) macht später Sinn
        norm.append({"t": t, "off": off})
    norm.sort(key=lambda p: p["t"])
    return norm

def _interp_off(points, t):
    """Linearer Offset zwischen den zwei umgebenden Punkten bei normiertem t."""
    n = len(points)
    if n < 2:
        return 0.0, 0, 0, 0.0  # off, i, i+1, u
    i = 0
    for k in range(n - 1):
        if t >= float(points[k]["t"]):
            i = k
    i = max(0, min(i, n - 2))
    a, b = points[i], points[i + 1]
    denom = (float(b["t"]) - float(a["t"])) or 1e-6
    u = (t - float(a["t"])) / denom
    off = float(a["off"]) + u * (float(b["off"]) - float(a["off"]))
    return off, i, i + 1, u

def _read_state(entity_id, default=None):
    v = state.get(entity_id)
    return v if v is not None else default

def _bool(entity_id: str, default=False) -> bool:
    s = (_read_state(entity_id, "off") or "off").lower()
    return s in ("on", "true", "1", "yes") if s is not None else default

def _notify(title: str, msg: str):
    service.call("persistent_notification", "create", title=title, message=msg)

def _summarize_points(points):
    # kurze JSON-Zusammenfassung ohne Leerzeichen
    try:
        return json.dumps(points, separators=(",", ":"))
    except Exception:
        return str(points)

# ------------- Kernberechnung ---------------------------
def _compute_and_set_delta(trigger_src: str = "manual"):
    dbg = ENT_DBG_FLAG #_bool(ENT_DBG_FLAG, False)
    if dbg:
        log.debug(f"[Heizkurve] _compute_and_set_delta start")
    # Eingänge lesen
    at   = _safe_float(_read_state(ENT_AT), 0)
    xMin = _safe_float(_read_state(ENT_X_MIN), -14)
    xMax = _safe_float(_read_state(ENT_X_MAX), 18)
    # VL-Min/Max werden hier nicht gebraucht, wenn wir nur Δ schreiben
    seg_raw = _read_state(ENT_SEG_JSON, "") or ""

    pts = _parse_points(seg_raw)
    span = (xMax - xMin) or 1.0
    t = _clamp01((at - xMin) / span)

    off, i0, i1, u = _interp_off(pts, t)
    delta05 = _round05(off)

    # Logging
    if dbg:
        log.info(
            f"[Heizkurve] tick via {trigger_src} | AT={at}°C, xMin={xMin}, xMax={xMax}, "
            f"t={t:.4f}, i={i0}, u={u:.3f}, off={off:.2f} -> Δ0.5={delta05:.1f}"
        )
        log.debug(f"[Heizkurve] points={_summarize_points(pts)}")

        if DEBUG_TO_NOTIFICATION:
            _notify(
                "Heizkurve Δ Debug",
                (
                    f"Trigger: {trigger_src}\n"
                    f"AT={at}°C, xMin={xMin}, xMax={xMax}\n"
                    f"t={t:.4f}, i={i0}..{i1}, u={u:.3f}\n"
                    f"off={off:.2f} → Δ(0.5)={delta05:.1f}\n"
                    f"Punkte={_summarize_points(pts)}"
                ),
            )

    # Nur setzen, wenn sich der Wert wirklich ändert (spart Writes/History)
    cur_delta = _safe_float(_read_state(ENT_DELTA), None)
    if cur_delta is None or abs(cur_delta - delta05) > 1e-9:
        service.call("input_number", "set_value", entity_id=ENT_DELTA, value=delta05)
        if dbg:
            log.info(f"[Heizkurve] {ENT_DELTA} <= {delta05:.1f}")
    else:
        if dbg:
            log.debug(f"[Heizkurve] unverändert (bleibt {cur_delta:.1f})")
    
    if dbg:
        log.debug(f"[Heizkurve] _compute_and_set_delta ende")

# ------------- Trigger ----------------------------------
@time_trigger("cron(0 * * * *)")  # stündlich, volle Stunde
def heizkurve_delta_hourly(**kwargs):
    _compute_and_set_delta(trigger_src="cron@hour")

# Optional: zusätzlich bei AT-Änderung (auskommentieren, wenn nicht gewünscht)
# @state_trigger(ENT_AT)
# def heizkurve_delta_on_at_change(**kwargs):
#     _compute_and_set_delta(trigger_src="AT-change")

# ------------- Manuell-Service --------------------------
@service
def heizkurve_force_recalc():
    """Manuell auslösbar: Developer Tools -> Dienste -> pyscript.heizkurve_force_recalc"""
    _compute_and_set_delta(trigger_src="manual-service")
