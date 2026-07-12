const WebSocket = require('ws');
const express   = require('express');
const app       = express();

// ── Config ────────────────────────────────────────────────────
const CENTER_LAT = 45.57;  // Sérezin-de-la-Tour
const CENTER_LON = 5.52;
const RADIUS_KM  = 40;
const MAX_STRIKES = 500;
const PORT       = process.env.PORT || 3000;

// ── Stockage en mémoire ───────────────────────────────────────
let strikes   = [];
let connected = false;
let lastSeen  = null;

// ── Haversine ─────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat/2)**2 +
                 Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
                 Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180) -
               Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];

const PLACES = [
    {n:'La Tour-du-Pin',     lat:45.573,lon:5.44},
    {n:'Bourgoin-Jallieu',   lat:45.585,lon:5.27},
    {n:"L'Isle-d'Abeau",     lat:45.617,lon:5.23},
    {n:'Morestel',           lat:45.673,lon:5.467},
    {n:'Saint-Chef',         lat:45.625,lon:5.39},
    {n:'Dolomieu',           lat:45.607,lon:5.487},
    {n:'Crémieu',            lat:45.73, lon:5.25},
    {n:'Vienne',             lat:45.525,lon:4.875},
    {n:'Voiron',             lat:45.365,lon:5.59},
    {n:'Pont-de-Beauvoisin', lat:45.535,lon:5.665},
    {n:'Champier',           lat:45.47, lon:5.33},
    {n:'Montalieu-Vercieu',  lat:45.82, lon:5.41},
    {n:'Belley',             lat:45.76, lon:5.685},
    {n:'Ambérieu-en-Bugey',  lat:45.96, lon:5.36},
    {n:'Grenoble',           lat:45.188,lon:5.724},
    {n:'Chambéry',           lat:45.564,lon:5.917},
    {n:'Bourg-en-Bresse',    lat:46.205,lon:5.225},
    {n:'Aix-les-Bains',      lat:45.688,lon:5.912},
    {n:'Lac de Paladru',     lat:45.45, lon:5.52},
    {n:'Villefontaine',      lat:45.61, lon:5.15},
    {n:'Tignieu-Jameyzieu',  lat:45.73, lon:5.17},
    {n:'Pont-de-Chéruy',     lat:45.75, lon:5.17},
    {n:'Meximieux',          lat:45.906,lon:5.194},
    {n:'Forêt de Bonnevaux', lat:45.51, lon:5.2},
];

function nearestPlace(lat, lon) {
    let best = null, bd = 999;
    for (const p of PLACES) {
        const d = Math.sqrt(Math.pow((lat-p.lat)*111,2)+Math.pow((lon-p.lon)*78,2));
        if (d < bd) { bd = d; best = p; }
    }
    return bd < 15 ? best.n : `${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`;
}

// ── Stockage debug ────────────────────────────────────────────
let rawMessages = [];
let lastRaw = null;

// ── Décodeur Blitzortung v4 — nettoyage + regex ───────────────
function blitzDecode(data) {
    const str = typeof data === 'string' ? data : data.toString();
    if (!str || str.length === 0) return null;

    // Essai 1 : JSON direct propre
    try {
        const parsed = JSON.parse(str);
        if (parsed && parsed.lat !== undefined) return parsed;
    } catch(e) {}

    // Essai 2 : nettoyer les caractères non-ASCII parasites
    // Garde uniquement : chiffres, lettres ASCII, ponctuation JSON standard
    try {
        // Remplace les caractères spéciaux (> 127) par rien
        // SAUF à l'intérieur des valeurs numériques où ils remplacent des chiffres
        // Stratégie : on nettoie et on reconstruit un JSON valide

        // Nettoyer : garder ASCII imprimable seulement
        let clean = '';
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if (code >= 32 && code <= 126) {
                clean += str[i];
            } else if (code > 127) {
                // Caractère spécial — peut représenter un chiffre manquant
                // On l'ignore (les chiffres autour restent)
                clean += '';
            }
        }

        // Extraire lat/lon du JSON nettoyé
        const latMatch = clean.match(/"lat[^"]*"\s*[:]+\s*(-?[\d.]+)/);
        const lonMatch = clean.match(/"lon[^"]*"\s*[:]+\s*(-?[\d.]+)/);
        const timeMatch = clean.match(/"time"\s*[:]+\s*([\d]+)/);
        const polMatch  = clean.match(/"pol[^"]*"\s*[:]+\s*(-?[\d]+)/);

        if (latMatch && lonMatch) {
            const lat = parseFloat(latMatch[1]);
            const lon = parseFloat(lonMatch[1]);
            const ts  = timeMatch ? parseInt(timeMatch[1]) : Date.now() * 1000000;

            // Validation basique des coordonnées
            if (isNaN(lat) || isNaN(lon)) return null;
            if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

            return {
                time: ts,
                lat:  lat,
                lon:  lon,
                pol:  polMatch ? parseInt(polMatch[1]) : 0,
            };
        }
    } catch(e) {
        console.log('Erreur décodage:', e.message);
    }

    return null;
}

// ── Connexion Blitzortung WebSocket ───────────────────────────
function connectBlitzortung() {
    const servers = ['ws1','ws2','ws3','ws4','ws5','ws6','ws7','ws8'];
    const server  = servers[Math.floor(Math.random() * servers.length)];
    const url     = `wss://${server}.blitzortung.org`;

    console.log(`[${new Date().toISOString()}] Connexion à ${url}...`);

    const ws = new WebSocket(url, {
        headers: { 'Origin': 'https://www.lightningmaps.org' }
    });

    ws.on('open', () => {
        console.log(`[${new Date().toISOString()}] WebSocket connecté !`);
        connected = true;
        ws.send(JSON.stringify({ a: 111 }));
    });

    ws.on('message', (data) => {
        lastSeen = new Date();
        const str = data.toString();

        // Garde les 5 derniers messages bruts pour debug
        lastRaw = str.slice(0, 200);
        rawMessages.unshift({ ts: new Date().toISOString(), raw: str.slice(0, 100), len: str.length });
        if (rawMessages.length > 5) rawMessages = rawMessages.slice(0, 5);

        // Essai décodage
        const strike = blitzDecode(str);

        if (!strike) {
            console.log(`Message non décodé (${str.length} chars): ${str.slice(0,50)}`);
            return;
        }

        // Support différents formats Blitzortung
        const sLat = parseFloat(strike.lat || (strike.location && strike.location.lat) || 0);
        const sLon = parseFloat(strike.lon || (strike.location && strike.location.lon) || 0);
        const ts   = strike.time ? Math.round(strike.time / 1e9) : Math.round(Date.now()/1000);

        if (!sLat || !sLon) {
            console.log('Impact sans coordonnées:', JSON.stringify(strike).slice(0,100));
            return;
        }

        console.log(`Impact brut reçu: lat=${sLat} lon=${sLon}`);

        // Filtre bounding box Europe
        if (sLat < 35 || sLat > 72 || sLon < -15 || sLon > 40) return;

        const dist = haversine(CENTER_LAT, CENTER_LON, sLat, sLon);
        if (dist > RADIUS_KM) {
            console.log(`Impact hors périmètre: ${dist.toFixed(0)} km`);
            return;
        }

        const brng  = bearing(CENTER_LAT, CENTER_LON, sLat, sLon);
        const dir   = DIRS[Math.round(brng/22.5) % 16];
        const place = nearestPlace(sLat, sLon);
        const id    = `bz_${Math.round(sLat*1000)}_${Math.round(sLon*1000)}_${ts}`;

        if (strikes.find(s => s.id === id)) return;

        const s = {
            id, ts,
            datetime:  new Date(ts*1000).toISOString().replace('T',' ').slice(0,19),
            dist_km:   Math.round(dist*10)/10,
            bearing:   Math.round(brng*10)/10,
            dir, place,
            lat: Math.round(sLat*100000)/100000,
            lon: Math.round(sLon*100000)/100000,
            source: 'blitzortung-ws',
            pol: strike.pol ?? 0,
        };

        strikes.unshift(s);
        if (strikes.length > MAX_STRIKES) strikes = strikes.slice(0, MAX_STRIKES);
        console.log(`⚡ IMPACT DÉTECTÉ: ${place} · ${s.dist_km} km ${dir}`);
    });

    ws.on('close', () => {
        connected = false;
        console.log(`[${new Date().toISOString()}] Déconnecté — reconnexion dans 5s...`);
        setTimeout(connectBlitzortung, 5000);
    });

    ws.on('error', (err) => {
        connected = false;
        console.error(`Erreur WS:`, err.message);
    });
}

// ── API REST ──────────────────────────────────────────────────
app.use(function(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

app.get('/debug', function(req, res) {
    res.end(JSON.stringify({
        connected,
        last_seen: lastSeen,
        total_strikes: strikes.length,
        last_raw_length: lastRaw ? lastRaw.length : 0,
        last_raw_preview: lastRaw ? lastRaw.slice(0, 150) : null,
        recent_messages: rawMessages,
    }, null, 2));
});

app.get('/', function(req, res) {
    res.end(JSON.stringify({ name: 'Blitzortung Proxy', version: '2.0', endpoints: ['/strikes', '/health', '/debug'] }));
});

app.get('/health', function(req, res) {
    res.end(JSON.stringify({ status: 'ok', connected: connected, last_seen: lastSeen, total_strikes: strikes.length }));
});

app.get('/strikes', function(req, res) {
    var now     = Date.now() / 1000;
    var minutes = parseInt(req.query.minutes) || 60;
    var filtered = strikes.filter(function(s) { return (now - s.ts) <= minutes * 60; });
    var today   = new Date().toISOString().slice(0, 10);
    var month   = new Date().toISOString().slice(0, 7);
    var year    = new Date().getFullYear().toString();
    var result  = {
        status:      'ok',
        source:      'blitzortung.org',
        center:      { lat: CENTER_LAT, lon: CENTER_LON, name: 'Sérezin-de-la-Tour' },
        radius_km:   RADIUS_KM,
        generated:   new Date().toISOString(),
        connected:   connected,
        last_seen:   lastSeen,
        counts: {
            today:      strikes.filter(function(s){ return s.datetime.startsWith(today); }).length,
            this_month: strikes.filter(function(s){ return s.datetime.startsWith(month); }).length,
            this_year:  strikes.filter(function(s){ return s.datetime.startsWith(year);  }).length,
            total:      strikes.length,
        },
        last_strike: strikes[0] || null,
        lightnings:  filtered,
    };
    res.end(JSON.stringify(result));
});

// ── Keep-alive — empêche Render de s'endormir ─────────────────
const https = require('https');
function keepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL || 'https://blitzortung-proxy.onrender.com';
    https.get(url + '/health', (res) => {
        console.log(`[${new Date().toISOString()}] Keep-alive ping OK (${res.statusCode})`);
    }).on('error', (e) => {
        console.log(`[${new Date().toISOString()}] Keep-alive ping erreur: ${e.message}`);
    });
}
// Ping toutes les 10 minutes
setInterval(keepAlive, 10 * 60 * 1000);

// ── Démarrage ─────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', function() {
    console.log('Serveur démarré sur port ' + PORT);
    connectBlitzortung();
    // Premier ping après 1 minute
    setTimeout(keepAlive, 60 * 1000);
});
