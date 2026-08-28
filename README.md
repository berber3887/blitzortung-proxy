# Proxy Blitzortung — Sérezin-de-la-Tour ⚡

Serveur Node.js qui se connecte au WebSocket **Blitzortung** et expose une API REST pour récupérer les impacts de foudre en temps réel dans les **15 km** autour de Sérezin-de-la-Tour (Isère, France).

Enrichissement automatique avec les vrais **kA (kiloampères)** via l'API **Xweather/Siemens BLIDS**, déclenchée uniquement lors d'une détection réelle.

---

## Fonctionnalités

- ⚡ Détection temps réel via WebSocket Blitzortung
- 📍 Localisation précise — **68 communes officielles INSEE** dans le périmètre 15 km
- 🔋 Intensité réelle en **kA** (Xweather/Siemens BLIDS) — même source que Météorage
- 🌩️ Type d'éclair : Nuage-sol ou Intra-nuageux
- ± Polarité de la décharge
- 🕐 Heures en timezone **Europe/Paris**
- 💾 Jusqu'à **2 000 impacts** en mémoire vive
- 🔄 Keep-alive automatique toutes les 10 min (évite l'endormissement Render)

---

## Déploiement sur Render.com (gratuit)

1. Créez un compte sur [render.com](https://render.com)
2. **New → Web Service → "Build and deploy from a Git repository"**
3. Connectez votre compte GitHub et sélectionnez ce dépôt
4. Render détecte automatiquement Node.js
5. **Start command** : `node server.js`
6. **Plan** : Free

> ⚠️ Le plan gratuit Render redémarre le serveur périodiquement. Les impacts en mémoire sont perdus au redémarrage — prévoir une sauvegarde locale par cron.

---

## API REST

### `GET /strikes`
Retourne les impacts récents dans les 15 km.

| Paramètre | Défaut | Description |
|---|---|---|
| `minutes` | 360 | Fenêtre temporelle en minutes |
| `limit` | 5 | Nombre max d'impacts retournés |

**Exemple :** `/strikes?minutes=60&limit=10`

**Réponse :**
```json
{
  "status": "ok",
  "source": "Xweather (kA réels) + Blitzortung (temps réel)",
  "center": { "lat": 45.5509, "lon": 5.3407, "name": "Sérezin-de-la-Tour" },
  "radius_km": 15,
  "connected": true,
  "counts": {
    "today": 42,
    "this_month": 573,
    "this_year": 573,
    "total": 573
  },
  "last_strike": {
    "place": "Champier",
    "dist_km": 6.3,
    "dir": "SSO",
    "ka": 111,
    "type": "Nuage-sol",
    "pol": 1,
    "intensity_icon": "⚡⚡⚡⚡",
    "intensity_desc": "111 kA · Décharge majeure"
  },
  "last_5": [ ... ],
  "lightnings": [ ... ]
}
```

### `GET /health`
Statut de connexion et compteurs globaux.

```json
{
  "status": "ok",
  "connected": true,
  "last_seen": "2026-08-28T09:05:00.000Z",
  "total_strikes": 573,
  "total_received": 2100000,
  "total_decoded": 2100000
}
```

### `GET /debug`
5 derniers impacts détectés avec détail complet.

---

## Échelle d'intensité

| kA | Niveau | Description |
|---|---|---|
| < 10 kA | ⚡ Faible | Décharge légère |
| 10–40 kA | ⚡⚡ Modérée | Décharge moyenne |
| 40–100 kA | ⚡⚡⚡ Forte | Décharge assez forte |
| > 100 kA | ⚡⚡⚡⚡ Très forte | Décharge majeure |
| > 200 kA | ⚡⚡⚡⚡ Exceptionnelle | Superbolt |

---

## Dépendances

```json
{
  "ws": "^8.18.0",
  "express": "^4.18.2"
}
```

---

## Sources de données

- **[Blitzortung.org](https://blitzortung.org)** — Réseau mondial de détection foudre en temps réel
- **[Xweather (AerisWeather)](https://www.xweather.com)** — Données kA via réseau Siemens BLIDS
- **[INSEE](https://www.insee.fr)** — Coordonnées officielles des 68 communes du périmètre

---

## Intégration MeteoTemplate

Ce proxy est utilisé par le site météo [meteoserezindelatour.fr](https://meteoserezindelatour.fr) via :
- `lightning_proxy.php` — Proxy PHP côté hébergement
- `fourdreBlock.php` — Bloc foudre avec carte OpenStreetMap/Leaflet
- `oragesBlock.php` — Statistiques orages (rose des vents, records kA, historique)
- `lightning_save.php` — Sauvegarde locale via cron toutes les 5 min

---

*Centre : 45.5509°N / 5.3407°E · Périmètre : 15 km · 68 communes INSEE*
