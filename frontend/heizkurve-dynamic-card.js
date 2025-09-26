/* Heizkurve Editor – dynamische Segmente (MIT)
 * - X-Achse fix: -20…+20 °C; Y: 20…60 °C
 * - Kontrollpunkte [{t,off}] mit t∈[0..1], off ∈ [-5..+5] (0.5er-Raster)
 * - Klick auf Linie: neuen Punkt einfügen; Drag: vertikal verschieben; 🗑: löschen
 * - Persistenz: input_text JSON (entities.segments_json)
 */

class HeizkurveDynamicCard extends HTMLElement {
  static X_MIN = -20;
  static X_MAX = 20;
  static Y_MIN = 20;
  static Y_MAX = 60;
  static MAX_POINTS = 10;

  set hass(hass) {
    if (!this._built) {
      this._built = true;
      this._hass = hass;
      const card = document.createElement("ha-card");
      card.header = this.config.title || "Heizkurve";
      const wrap = document.createElement("div");
      wrap.style.padding = "16px";
      wrap.style.position = "relative";
      const responsive = this.config.responsive !== false;
      const aspect = Number(this.config.aspect_ratio ?? 0.55);
      const maxVh = Number(this.config.max_height_vh ?? 70);   // 70% Viewport-Höhe
      const maxPx = this.config.max_height_px ? Number(this.config.max_height_px) : null;
      const minPx = Number(this.config.min_height_px ?? 280);


      wrap.innerHTML = `
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
            <button id="saveBtn"  style="all:unset;cursor:pointer;padding:10px 14px;border-radius:10px;background:var(--success-color,#2e7d32);color:#fff;font-weight:700;border:2px solid var(--success-color,#2e7d32)">💾 Speichern</button>
            <button id="resetBtn" style="all:unset;cursor:pointer;padding:10px 14px;border-radius:10px;background:var(--primary-color,#1e88e5);color:#fff;font-weight:700;border:2px solid var(--primary-color,#1e88e5)">↺ Zurücksetzen</button>
            <span id="status" style="font:13px system-ui;color:var(--secondary-text-color,#6b7280)"></span>
          </div>

          <div id="canvasWrap" style="position:relative;width:100%;${responsive ? `aspect-ratio:${(1/Math.max(0.05,aspect)).toFixed(4)}/1;` : ""}">
            <canvas id="curve" style="width:100%;height:100%;display:block;border:1px solid var(--divider-color,#9ca3af);border-radius:8px;touch-action:none;cursor:crosshair;background:var(--card-background-color,#fafafa)"></canvas>
            <div id="tooltip" style="position:absolute;pointer-events:none;display:none;background:rgba(0,0,0,.85);color:#fff;padding:6px 8px;border-radius:6px;font:12px system-ui;z-index:2;white-space:nowrap"></div>
          </div>

          <div id="info" style="margin-top:8px;font:14px system-ui;color:var(--primary-text-color,#222)"></div>

          <div id="inputs"></div>
        `;
      const canvasWrapEl = wrap.querySelector("#canvasWrap");
      canvasWrapEl.style.minHeight = `${minPx}px`;
      if (maxPx) {
        canvasWrapEl.style.maxHeight = `${maxPx}px`;
      } else if (maxVh) {
        canvasWrapEl.style.maxHeight = `${maxVh}vh`;
      }
      canvasWrapEl.style.overflow = "hidden"; // zur Sicherheit, falls Tooltips o.ä. groß werden
        
      card.appendChild(wrap);
      this.appendChild(card);

      // Refs
      this._canvasWrap = wrap.querySelector("#canvasWrap");
      this._canvas = wrap.querySelector("#curve");
      this._ctx = this._canvas.getContext("2d");
      this._tooltip = wrap.querySelector("#tooltip");
      this._info = wrap.querySelector("#info");
      this._status = wrap.querySelector("#status");
      this._saveBtn = wrap.querySelector("#saveBtn");
      this._resetBtn = wrap.querySelector("#resetBtn");
      this._inputs = wrap.querySelector("#inputs");

      // Layout
      this._M = { top: 28, right: 24, bottom: 50, left: 70 };
      this._plotW = 0;
      this._plotH = 0;

      // State
      this._dragIndex = null;
      this._hoverX = null;
      this._hoverPoint = null;
      this._hoverTrash = null;
      this._segments = null; // [{t,off}, ...] t∈[0..1]
      this._changed = false;
      this._lockEndpoints = this.config.lock_endpoints !== false;

      // Theme
      this._computeTheme(card);

      // Entities-Card (Standard) für die 4 Parameter
      this._buildEntitiesCard();

      // Pointer
      this._canvas.addEventListener("pointerdown", this._onPointerDown.bind(this), { passive: false });
      this._canvas.addEventListener("pointermove", this._onPointerMove.bind(this), { passive: false });
      window.addEventListener("pointerup", this._onPointerUp.bind(this), { passive: false });
      this._canvas.addEventListener("mouseleave", () => {
        this._hoverX = null;
        this._hoverPoint = null;
        this._hoverTrash = null;
        this._tooltip.style.display = "none";
        this._draw();
      });

      // Buttons
      this._saveBtn.addEventListener("click", () => this._saveSegmentsToJson());
      this._resetBtn.addEventListener("click", () => {
        this._segments = [{ t: 0, off: 0 }, { t: 1, off: 0 }];
        this._changed = true;
        this._updateStatus();
        this._buildCurve();
        this._draw();
      });

      // Responsive sizing
      if (responsive) {
        const ro = new ResizeObserver(() => this._resize());
        ro.observe(this._canvasWrap);
        this._ro = ro;
        this._resize();
      } else {
        // fixed fallback
        const w = Number(this.config.width || 1000), h = Number(this.config.height || 520);
        const dpr = window.devicePixelRatio || 1;
        this._canvas.width = w * dpr;
        this._canvas.height = h * dpr;
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._plotW = w - this._M.left - this._M.right;
        this._plotH = h - this._M.top - this._M.bottom;
      }
    }

    // Update
    this._hass = hass;
    this._readEntities();
    if (this._entitiesCard) this._entitiesCard.hass = hass;
    this._loadSegmentsFromJson(); // liest JSON -> this._segments (falls noch nicht gesetzt)
    this._buildCurve();
    this._draw();
  }

  setConfig(config) {
    this.config = config || {};
    const e = this.config.entities || {};
    if (!e.min_outdoor || !e.max_outdoor || !e.vl_min || !e.vl_max || !e.current_outdoor || !e.segments_json) {
      throw new Error("entities.min_outdoor, max_outdoor, vl_min, vl_max, current_outdoor, segments_json erforderlich.");
    }
  }
  getCardSize() { return 7; }

  // THEME --------------------------------------------------------
  _getVar(el, name, fb) {
    const v = getComputedStyle(el).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fb;
  }
  _rgba(c, a, fb = "#000") {
    let x = (c || "").trim();
    if (!x) x = fb;
    if (x.startsWith("rgb")) {
      const n = x.replace(/[^\d.,]/g, "").split(",").map(Number);
      const [r, g, b] = n;
      const al = a !== undefined ? a : n[3] ?? 1;
      return `rgba(${r || 0},${g || 0},${b || 0},${al})`;
    }
    const m = x.replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return `rgba(0,0,0,${a ?? 1})`;
    let h = m[1];
    if (h.length === 3) h = h.split("").map((y) => y + y).join("");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a ?? 1})`;
  }
  _computeTheme(card) {
    const pt = this._getVar(card, "--primary-text-color", "#eaeaea");
    const st = this._getVar(card, "--secondary-text-color", "#9aa0a6");
    const dv = this._getVar(card, "--divider-color", "#9ca3af");
    const bg = this._getVar(card, "--card-background-color", "#202124");
    const isDark = parseInt(bg.replace("#", "").slice(0, 2), 16) < 0x80;
    this._col = {
      text: pt,
      text2: st,
      gridMajor: this._rgba(dv, isDark ? 0.7 : 0.35),
      gridMinor: this._rgba(dv, isDark ? 0.5 : 0.18),
      axis: this._rgba(pt, 0.92),
      tick: this._rgba(pt, 0.92),
      label: this._rgba(pt, 0.98),
      curve: this._getVar(card, "--state-icon-color", "#8ab4f8"),
      pointFill: this._getVar(card, "--accent-color", "#ff8a65"),
      pointLocked: this._rgba(pt, 0.6),
      currentAT: this._getVar(card, "--success-color", "#81c995"),
      idealCurve: this._rgba(pt, isDark ? 0.45 : 0.25),
      bg: bg,
    };
    if (this._tooltip) {
      this._tooltip.style.background = "rgba(0,0,0,.85)";
      this._tooltip.style.color = "#fff";
    }
  }

  // ENTITIES / STATE --------------------------------------------
  _buildEntitiesCard() {
    const e = this.config.entities;
    const cfg = { type: "entities", title: "Basis-Parameter", entities: [e.min_outdoor, e.max_outdoor, e.vl_min, e.vl_max], state_color: true };
    const el = document.createElement("hui-entities-card");
    el.setConfig(cfg);
    this._inputs.innerHTML = "";
    this._inputs.appendChild(el);
    this._entitiesCard = el;
  }
  _readEntities() {
    const e = this.config.entities, S = this._hass.states, num = (id) => (S[id] ? parseFloat(S[id].state) : NaN);
    this._xMinEnt = isFinite(num(e.min_outdoor)) ? num(e.min_outdoor) : -14;
    this._xMaxEnt = isFinite(num(e.max_outdoor)) ? num(e.max_outdoor) : 18;
    this._yAtMin = isFinite(num(e.vl_min)) ? num(e.vl_min) : 40;
    this._yAtMax = isFinite(num(e.vl_max)) ? num(e.vl_max) : 26;
    this._curAT  = isFinite(num(e.current_outdoor)) ? num(e.current_outdoor) : 0;
    // Skalen (CSS px)
    this._x = (x) => this._M.left + ((x - HeizkurveDynamicCard.X_MIN) / (HeizkurveDynamicCard.X_MAX - HeizkurveDynamicCard.X_MIN)) * this._plotW;
    this._y = (y) => this._cssH - this._M.bottom - ((y - HeizkurveDynamicCard.Y_MIN) / (HeizkurveDynamicCard.Y_MAX - HeizkurveDynamicCard.Y_MIN)) * this._plotH;
  }

  // SEGMENTS (JSON) ---------------------------------------------
  _loadSegmentsFromJson() {
    if (this._segments) return; // schon geladen/gesetzt
    const id = this.config.entities.segments_json;
    const st = this._hass.states[id]?.state;
    try {
      const obj = st ? JSON.parse(st) : null;
      const pts = obj?.points;
      if (Array.isArray(pts) && pts.length >= 2) {
        this._segments = pts.map((p) => ({ t: this._clamp01(p.t), off: this._snapOff(p.off) })).sort((a, b) => a.t - b.t);
        // Endpunkte sicherstellen
        if (this._segments[0].t !== 0) this._segments.unshift({ t: 0, off: 0 });
        if (this._segments.at(-1).t !== 1) this._segments.push({ t: 1, off: 0 });
      } else {
        this._segments = [{ t: 0, off: 0 }, { t: 1, off: 0 }];
      }
    } catch (e) {
      this._segments = [{ t: 0, off: 0 }, { t: 1, off: 0 }];
    }
    this._changed = false;
    this._updateStatus();
  }
  async _saveSegmentsToJson() {
    const id = this.config.entities.segments_json;
    const payload = JSON.stringify({ v: 1, points: this._segments.map((p) => ({ t: +p.t.toFixed(4), off: +p.off.toFixed(1) })) });
    await this._hass.callService("input_text", "set_value", { entity_id: id, value: payload });
    this._changed = false;
    this._updateStatus();
  }

  _clamp01(v) { return Math.min(1, Math.max(0, Number(v) || 0)); }
  _snapOff(v) { const n = Math.max(-5, Math.min(5, Number(v) || 0)); return Math.round(n * 2) / 2; }

  // GEOMETRIE / KURVE -------------------------------------------
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = this._canvasWrap.clientWidth;
    // Wunschhöhe aus aspect-ratio ableiten:
    let ch = this._canvasWrap.clientHeight;
  
    // Kappen respektieren
    const maxH = parseFloat(this._canvasWrap.style.maxHeight) || null;
    if (maxH && ch > maxH) {
      // Höhe festklopfen, damit Sections uns nicht weiter strecken
      this._canvasWrap.style.height = `${maxH}px`;
      ch = maxH;
    }
  
    this._canvas.width  = Math.max(1, Math.round(cw * dpr));
    this._canvas.height = Math.max(1, Math.round(ch * dpr));
    this._canvas.style.width = cw + "px";
    this._canvas.style.height = ch + "px";
    this._ctx.setTransform(dpr,0,0,dpr,0,0);
  
    this._cssW = cw; this._cssH = ch;
    this._plotW = cw - this._M.left - this._M.right;
    this._plotH = ch - this._M.top  - this._M.bottom;
  
    const haveScales = (typeof this._x === "function") && (typeof this._y === "function");
    if (!haveScales) return;
    if (this._segments) this._buildCurve();
    this._draw();
  }

  _idealAt(xVal) {
    const denom = this._xMaxEnt - this._xMinEnt;
    const slope = denom === 0 ? 0 : (this._yAtMax - this._yAtMin) / denom;
    return this._yAtMin + slope * (xVal - this._xMinEnt);
  }

  // Offset(t) linear zwischen Segmentpunkten
  _offsetAtT(t) {
    const pts = this._segments;
    let i = 0;
    while (i < pts.length - 2 && t >= pts[i + 1].t) i++;
    const a = pts[i], b = pts[i + 1];
    const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return a.off + u * (b.off - a.off);
  }

  // baut Stützpunkte entlang der aktuellen Segmente
  _buildCurve() {
    if (typeof this._x !== "function" || typeof this._y !== "function") return;
    const spanEnt = this._xMaxEnt - this._xMinEnt || 1;
    this._pts = this._segments.map((p, idx) => {
      const xVal = this._xMinEnt + p.t * spanEnt;
      const base = this._clampY(this._idealAt(xVal));
      const yVal = this._clampY(base + p.off);
      return { idx, t: p.t, off: p.off, xVal, baseYVal: base, yVal, x: this._x(xVal), y: this._y(yVal), baseY: this._y(base) };
    });
  }
  _clampY(v) { return Math.min(HeizkurveDynamicCard.Y_MAX, Math.max(HeizkurveDynamicCard.Y_MIN, v)); }

  // RENDER -------------------------------------------------------
  _draw() {
    // Ohne Skalen kein Zeichnen (kann beim allerersten Resize passieren)
    if (typeof this._x !== "function" || typeof this._y !== "function") return;

    const ctx = this._ctx, W = this._cssW, H = this._cssH, M = this._M;
    ctx.clearRect(0, 0, W, H);
    // bg
    ctx.fillStyle = this._col.bg; ctx.fillRect(0, 0, W, H);

    // grid X
    ctx.lineWidth = 1;
    for (let t = HeizkurveDynamicCard.X_MIN; t <= HeizkurveDynamicCard.X_MAX; t += 5) {
      const x = this._M.left + ((t - HeizkurveDynamicCard.X_MIN) / (HeizkurveDynamicCard.X_MAX - HeizkurveDynamicCard.X_MIN)) * this._plotW;
      ctx.strokeStyle = t === 0 ? this._col.gridMajor : this._col.gridMinor;
      ctx.beginPath(); ctx.moveTo(x, M.top); ctx.lineTo(x, H - M.bottom); ctx.stroke();
    }
    // grid Y
    for (let t = HeizkurveDynamicCard.Y_MIN; t <= HeizkurveDynamicCard.Y_MAX; t += 5) {
      const y = this._y(t);
      ctx.strokeStyle = (t % 10 === 0) ? this._col.gridMajor : this._col.gridMinor;
      ctx.beginPath(); ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke();
    }

    // axes
    ctx.strokeStyle = this._col.axis; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(M.left, M.top); ctx.lineTo(M.left, H - M.bottom); ctx.lineTo(W - M.right, H - M.bottom); ctx.stroke();

    // labels
    ctx.fillStyle = this._col.label; ctx.font = "12px system-ui"; ctx.textAlign = "center";
    ctx.fillText("Außentemperatur (°C)", W / 2, H - 8);
    ctx.save(); ctx.translate(20, H / 2 + 36); ctx.rotate(-Math.PI / 2); ctx.fillText("Vorlauftemperatur (°C)", 0, 0); ctx.restore();

    // ticks
    ctx.fillStyle = this._col.label; ctx.textAlign = "center";
    for (let t = HeizkurveDynamicCard.X_MIN; t <= HeizkurveDynamicCard.X_MAX; t += 5) {
      const x = this._M.left + ((t - HeizkurveDynamicCard.X_MIN) / (HeizkurveDynamicCard.X_MAX - HeizkurveDynamicCard.X_MIN)) * this._plotW;
      ctx.strokeStyle = this._col.tick; ctx.beginPath(); ctx.moveTo(x, H - M.bottom); ctx.lineTo(x, H - M.bottom + 6); ctx.stroke();
      ctx.fillText(`${t}°`, x, H - M.bottom + 19);
    }
    ctx.textAlign = "right";
    for (let t = HeizkurveDynamicCard.Y_MIN; t <= HeizkurveDynamicCard.Y_MAX; t += 5) {
      const y = this._y(t);
      ctx.strokeStyle = this._col.tick; ctx.beginPath(); ctx.moveTo(M.left - 6, y); ctx.lineTo(M.left, y); ctx.stroke();
      ctx.fillText(`${t}°`, M.left - 10, y + 4);
    }

    // ideal line sampled at segment x's
    const spanEnt = this._xMaxEnt - this._xMinEnt || 1;
    const idealPts = this._segments.map((p) => {
      const xv = this._xMinEnt + p.t * spanEnt;
      return { x: this._x(xv), y: this._y(this._clampY(this._idealAt(xv))) };
    });
    ctx.beginPath(); ctx.moveTo(idealPts[0].x, idealPts[0].y);
    for (let i = 1; i < idealPts.length; i++) ctx.lineTo(idealPts[i].x, idealPts[i].y);
    ctx.strokeStyle = this._col.idealCurve; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);

    // current curve through dynamic points
    if (!this._pts || this._pts.length === 0) return;
    ctx.beginPath(); ctx.moveTo(this._pts[0].x, this._pts[0].y);
    for (let i = 1; i < this._pts.length; i++) ctx.lineTo(this._pts[i].x, this._pts[i].y);
    ctx.strokeStyle = this._col.curve; ctx.lineWidth = 2.2; ctx.stroke();

    // draw points + trash
    this._hoverPoint = null; this._hoverTrash = null;
    const mouse = this._lastMouse;
    for (const p of this._pts) {
      const locked = this._lockEndpoints && (p.idx === 0 || p.idx === this._pts.length - 1);
      const r = 10;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = locked ? this._col.pointLocked : this._col.pointFill;
      ctx.fill(); ctx.strokeStyle = this._col.axis; ctx.stroke();

      // trash area (not for endpoints)
      if (!locked) {
        const tx = p.x + 16, ty = p.y - 16, tw = 18, th = 18;
        ctx.save(); ctx.translate(tx, ty);
        ctx.fillStyle = this._col.label; ctx.fillRect(-tw / 2, -th / 2, tw, th);
        ctx.fillStyle = this._col.bg; ctx.fillRect(-tw / 4, -th / 6, tw / 2, th / 2);
        ctx.restore();

        if (mouse) {
          const inTrash = Math.abs(mouse.x - tx) <= tw / 2 && Math.abs(mouse.y - ty) <= th / 2;
          if (inTrash) this._hoverTrash = p.idx;
        }
      }

      // hover detection for point
      if (mouse && Math.hypot(mouse.x - p.x, mouse.y - p.y) < r + 4) this._hoverPoint = p.idx;
    }

    // current outdoor vertical
    const curX = this._x(this._curAT);
    ctx.beginPath(); ctx.moveTo(curX, M.top); ctx.lineTo(curX, H - M.bottom);
    ctx.setLineDash([6, 6]); ctx.strokeStyle = this._col.currentAT; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);

    // hover line & tooltip (if not dragging)
    if (this._hoverX !== null && this._dragIndex === null) {
      ctx.beginPath(); ctx.moveTo(this._hoverX, M.top); ctx.lineTo(this._hoverX, H - M.bottom);
      ctx.strokeStyle = this._rgba(this._col.text, 0.35); ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      const xVal = HeizkurveDynamicCard.X_MIN + ((this._hoverX - this._M.left) * (HeizkurveDynamicCard.X_MAX - HeizkurveDynamicCard.X_MIN)) / this._plotW;
      const t = (xVal - this._xMinEnt) / Math.max(1e-6, this._xMaxEnt - this._xMinEnt);
      const off = this._offsetAtT(this._clamp01(t));
      const vl = this._clampY(this._idealAt(this._xMinEnt + this._clamp01(t) * (this._xMaxEnt - this._xMinEnt)) + off);
      const ideal = this._idealAt(this._xMinEnt + this._clamp01(t) * (this._xMaxEnt - this._xMinEnt));
      const delta05 = Math.round((vl - ideal) * 2) / 2;
      const py = this._y(vl);
      this._tooltip.style.left = `${Math.round(this._hoverX)}px`;
      this._tooltip.style.top  = `${Math.round(py) - 14}px`;
      this._tooltip.style.transform = "translate(-50%,-100%)";
      this._tooltip.innerHTML = `AT: ${xVal.toFixed(1)}°C · t: ${this._clamp01(t).toFixed(2)}<br>VL: ${vl.toFixed(1)}°C · Δ: ${delta05 >= 0 ? "+" : ""}${delta05.toFixed(1)}°C`;
      this._tooltip.style.display = "block";
    } else {
      this._tooltip.style.display = "none";
    }

    // info line (verwende spanEnt von oben NICHT neu zuweisen!)
    const tc = this._clamp01((this._curAT - this._xMinEnt) / Math.max(1e-6, spanEnt));
    const offc = this._offsetAtT(tc);
    const vlc  = this._clampY(this._idealAt(this._curAT) + offc);
    const deltac = Math.round((vlc - this._idealAt(this._curAT)) * 2) / 2;
    this._info.innerHTML = `Aktuelle AT: ${this._curAT.toFixed(1)}°C · Soll VL: ${vlc.toFixed(1)}°C · Δ: ${deltac >= 0 ? "+" : ""}${deltac.toFixed(1)}°C`;
    this._updateStatus();
  }

  _updateStatus() {
    this._status.textContent = this._changed ? "Änderungen nicht gespeichert" : "Alle Änderungen gespeichert";
    this._status.style.color = this._changed ? "var(--warning-color,#e65100)" : "var(--secondary-text-color,#6b7280)";
  }

  // INTERAKTION --------------------------------------------------
  _xToVal(px) {
    return HeizkurveDynamicCard.X_MIN + ((px - this._M.left) * (HeizkurveDynamicCard.X_MAX - HeizkurveDynamicCard.X_MIN)) / this._plotW;
  }

  _onPointerDown(ev) {
    ev.preventDefault();
    const rect = this._canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    this._lastMouse = { x: mx, y: my };

    // Trash click?
    if (this._hoverTrash != null) {
      const idx = this._hoverTrash;
      if (!(this._lockEndpoints && (idx === 0 || idx === this._segments.length - 1))) this._deletePointAtIndex(idx);
      return;
    }

    // Point drag?
    const p = this._getPointAt(mx, my);
    if (p) {
      if (this._lockEndpoints && (p.idx === 0 || p.idx === this._segments.length - 1)) return;
      this._dragIndex = p.idx;
      this._canvas.setPointerCapture(ev.pointerId);
      this._canvas.style.cursor = "grabbing";
      return;
    }

    // Click on curve -> add point
    const xVal = this._xToVal(mx);
    const t = this._clamp01((xVal - this._xMinEnt) / Math.max(1e-6, this._xMaxEnt - this._xMinEnt));
    const off = this._offsetAtT(t);
    // Nur wenn nah an der Linie (max 10 px Distanz)
    const yOnCurve = this._clampY(this._idealAt(this._xMinEnt + t * (this._xMaxEnt - this._xMinEnt)) + off);
    const dyPx = Math.abs(this._y(yOnCurve) - my);
    if (dyPx <= 10) {
      this._addPointAt(t, off);
    } else {
      // nur Hover-Linie setzen
      if (mx >= this._M.left && mx <= this._cssW - this._M.right) this._hoverX = mx;
      this._draw();
    }
  }

  _onPointerMove(ev) {
    const rect = this._canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    this._lastMouse = { x: mx, y: my };

    if (this._dragIndex === null) {
      // hover updates
      if (mx >= this._M.left && mx <= this._cssW - this._M.right) this._hoverX = mx;
      else this._hoverX = null;
      this._draw();
      return;
    }

    // dragging point vertically within ±5 and Y bounds
    const idx = this._dragIndex;
    const p = this._segments[idx];
    const span = this._xMaxEnt - this._xMinEnt || 1;
    const xVal = this._xMinEnt + p.t * span;
    const base = this._clampY(this._idealAt(xVal));
    // invert y
    const yVal = HeizkurveDynamicCard.Y_MIN + ((this._cssH - this._M.bottom - my) * (HeizkurveDynamicCard.Y_MAX - HeizkurveDynamicCard.Y_MIN)) / this._plotH;
    const within = Math.min(base + 5, Math.max(base - 5, yVal));
    p.off = this._snapOff(within - base);
    this._changed = true;
    this._buildCurve();
    this._draw();
  }

  _onPointerUp(ev) {
    if (this._dragIndex === null) return;
    try { this._canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
    this._dragIndex = null;
    this._canvas.style.cursor = "crosshair";
  }

  _getPointAt(mx, my) {
    for (const p of this._pts) if (Math.hypot(p.x - mx, p.y - my) < 12) return p;
    return null;
  }

  _addPointAt(t, off) {
    // Limit prüfen
    if (this._segments.length >= HeizkurveDynamicCard.MAX_POINTS) {
      this._status.textContent = `Maximal ${HeizkurveDynamicCard.MAX_POINTS} Punkte erreicht`;
      this._status.style.color = "var(--warning-color,#e65100)";
      return;
    }
    // zu nahe an bestehenden Punkten? (z.B. < 0.03 in t)
    const tooClose = this._segments.some((p) => Math.abs(p.t - t) < 0.03);
    if (tooClose) return;

    const p = { t: this._clamp01(t), off: this._snapOff(off) };
    this._segments.push(p);
    this._segments.sort((a, b) => a.t - b.t);

    // Endpunkte schützen/erzwingen
    if (this._segments[0].t !== 0) this._segments.unshift({ t: 0, off: 0 });
    if (this._segments.at(-1).t !== 1) this._segments.push({ t: 1, off: 0 });

    this._changed = true;
    this._buildCurve();
    this._draw();
    this._updateStatus();
  }

  _deletePointAtIndex(idx) {
    if (this._lockEndpoints && (idx === 0 || idx === this._segments.length - 1)) return;
    this._segments.splice(idx, 1);
    // mind. 2 Punkte behalten
    if (this._segments.length < 2) this._segments = [{ t: 0, off: 0 }, { t: 1, off: 0 }];
    this._changed = true;
    this._buildCurve();
    this._draw();
    this._updateStatus();
  }
}

customElements.define("heizkurve-dynamic-card", HeizkurveDynamicCard);
