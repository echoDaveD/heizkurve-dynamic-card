# Heizkurve Dynamic (Lovelace Card + Server-Logik)

## Support the Project

If you like this integration and want to support further development, you can donate via PayPal:

[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/donate?hosted_button_id=S2TUVZPX2MQ6Q)

## 🔥 Heizkurve Dynamic Card – Funktionsbeschreibung

Die **Heizkurve Dynamic Card** visualisiert und steuert die Heizkennlinie (Vorlauftemperatur in Abhängigkeit von der Außentemperatur) direkt in Home Assistant.  
Es ist aktuell von den Entitäten und begrenzungen der helferentitäten auf Samsung Wärmepumpen und den EHS-Sentinel asugerichtet, lässt sich jedoch relativ leicht auch für andere Heizungen abändern.

**Funktionen:**
- 📈 Zeichnet die Soll-Heizkurve basierend auf den Parametern:
  - minimale/maximale Außentemperatur (`min_outdoor`, `max_outdoor`)
  - Vorlauftemperatur bei Minimal- und Maximalwert (`vl_min`, `vl_max`)
- ➕ Benutzer können per Klick zusätzliche Segmente (Kontrollpunkte) auf der Kurve setzen und diese per Drag & Drop verschieben.
- 🗑️ Segmente können mit einem kleinen Papierkorb-Icon entfernt werden (Endpunkte sind fixiert).
- 💾 Änderungen werden als JSON in einer `input_text`-Entität gespeichert (`input_text.heizkurve_segments`).
- 🔄 Automatisches Berechnen und Aktualisieren des Heizkurven-Delta (Differenz zur Ideal-Kurve) über ein Pyscript oder eine Automation.
- 🎨 Anpassung an Light/Dark-Mode mit dynamischen Farben und Grid-Lines.
- Das eingestellte Delta zur aktuellen Außentemperatur befindet sich dann in der Entität `input_number.heizkurve_delta`. Man könnte dann diesen Werte in die Eigene Heizung übernehmen lassen.

**Beispiel-Nutzung:**
- Außentemperatur bei **0 °C → Vorlauf 40 °C**  
- Außentemperatur bei **-10 °C → Vorlauf 55 °C**  
- Über zusätzliche Punkte lässt sich die Kurve dynamisch anpassen (z. B. mehr Vorlauf bei -5 °C, weniger Vorlauf bei +5 °C).  
- Das Ergebnis (Delta zur Ideal-Kurve) wird berechnet und kann für die Heizungsregelung genutzt werden.

![alt text](heizkurve-dynamic-card-demo.gif)

---

## Inhaltsverzeichnis
- [Installation (Card via HACS)](#installation-card-via-hacs)
- [Manuelle Installation (ohne HACS)](#manuelle-installation-ohne-hacs)
- [Benötigte Helfer / Entitäten](#benötigte-helfer--entitäten)
- [Pyscript – automatische Δ-Berechnung](#pyscript--automatische--berechnung)
- [Card in Lovelace einbinden](#card-in-lovelace-einbinden)
- [Troubleshooting](#troubleshooting)

---

## Installation (Card via HACS)

1. **HACS → Benutzerdefinierte Repositories → „Frontend“**
   - URL deines Repos hinzufügen: `https://github.com/echoDaveD/heizkurve-dynamic-card`
   - Danach unter **HACS → Frontend** die Card „**Heizkurve Dynamic**“ installieren.
2. **Ressource** wird automatisch hinzugefügt (Pfad ähnlich):
   ```
   /hacsfiles/heizkurve-dynamic/dist/heizkurve-dynamic-card.js
   ```
3. **Cache-Bust**: Nach Updates ggf. in der Ressourcen-URL `?v=1.2.3` anhängen.

## Manuelle Installation (ohne HACS)

1. Datei `dist/heizkurve-dynamic-card.js` nach:
   ```
   <config>/www/community/heizkurve-dynamic/heizkurve-dynamic-card.js
   ```
2. Ressource unter **Einstellungen → Dashboards → Ressourcen**:
   - URL: `/local/community/heizkurve-dynamic/heizkurve-dynamic-card.js?v=1.0.0`
   - Typ: **JavaScript-Modul**

---

## Benötigte Helfer / Entitäten

> Per UI: **Einstellungen → Geräte & Dienste → Helfer**  
> Oder YAML (siehe `examples/helpers.yaml`):

- `input_text.heizkurve_segments` – JSON der Segmente (max 255 Zeichen)
- `input_number.heizkurve_delta` – Ergebnis-Δ in 0.5°
- `input_boolean.heizkurve_debug` (optional) – Debug-Mode fürs Pyscript

**Außerdem deine bestehenden Sensoren/Nummern:**
- `sensor.samsung_ehssentinel_outdoorouttemp` (Außentemperatur)
- `number.samsung_ehssentinel_infsv2011` (min. Außentemp, z. B. –14)
- `number.samsung_ehssentinel_infsv2012` (max. Außentemp, z. B. +18)
- `number.samsung_ehssentinel_infsv2021` (VL bei min AT, z. B. 40)*
- `number.samsung_ehssentinel_infsv2022` (VL bei max AT, z. B. 26)*

\* Die Card zeigt die ideale Linie aus VL_min/VL_max; Pyscript nutzt für Δ nur die Offsets.

---

## Pyscript – automatische Δ-Berechnung

1. **Pyscript installieren** (HACS → Integrationen → „Pyscript“ → installieren).
2. In `configuration.yaml`:
   ```yaml
   pyscript:
   ```
3. Datei `pyscript/heizkurve_delta.py` in `<config>/pyscript/` kopieren.
4. HA **neustarten** oder Pyscript in den Integrationen **neu laden**.
5. Optional: `input_boolean.heizkurve_debug` anlegen (siehe Helpers).
6. **Manuell testen**: Dienst `pyscript.heizkurve_force_recalc`.
7. Ab jetzt läuft die Berechnung **stündlich** automatisch (`cron(0 * * * *)`).

**Debug:**
- Schalte `input_boolean.heizkurve_debug` **an** → Logs + optionale persistente Notification pro Tick.
- Logs: *Einstellungen → System → Protokolle* (Pyscript filtern).

---

## Card in Lovelace einbinden

Beispiel (Sections/Grid, volle Breite):

```yaml
type: custom:heizkurve-dynamic-card
title: Heizkurve (dynamische Segmente)
responsive: true
aspect_ratio: 0.55
lock_endpoints: true
# optional, wenn die Card-Höhenkappen unterstützt
max_height_vh: 60
min_height_px: 320
entities:
  min_outdoor: number.samsung_ehssentinel_infsv2011
  max_outdoor: number.samsung_ehssentinel_infsv2012
  vl_min: number.samsung_ehssentinel_infsv2021
  vl_max: number.samsung_ehssentinel_infsv2022
  current_outdoor: sensor.samsung_ehssentinel_outdoorouttemp
  segments_json: input_text.heizkurve_segments
```

Optional: komplette View siehe `examples/lovelace_dashboard.yaml`.

---

## Troubleshooting

- **Card lädt nicht / weißer Kasten**  
  → Ressource prüfen, Browser-Cache leeren / `?v=` anhängen.
- **Gridlines/Schrift zu dunkel im Dark-Mode**  
  → Card nutzt Theme-Variablen (`--divider-color`, `--primary-text-color`). Passe dein Theme an oder erhöhe Kontraste.
- **Chart wird unendlich hoch**  
  → In der Card `max_height_vh`/`max_height_px` nutzen oder im Dashboard `card_mod` mit `max-height` setzen.
- **Δ bleibt 0**  
  → Prüfe `x_min/x_max`, aktuelle AT, und ob `input_text.heizkurve_segments` gültiges JSON enthält.  
  → Pyscript-Debug anschalten → Notification zeigt alle Zwischenwerte (t, i, offA/B, off_val).
- **Pyscript-Fehler „bool object has no attribute split“**  
  → Eine Entity-Konstante ist kein String. In `pyscript/heizkurve_delta.py` **alle `ENT_*`-IDs als Strings** angeben.

---

## Credits

- Beiträge willkommen — Issues/PRs gerne im Repo anlegen.
