const WebSocket = require('ws');
const express   = require('express');
const app       = express();
const PORT      = process.env.PORT || 3000;

const CENTER_LAT  = 45.5509;
const CENTER_LON  = 5.3407;
const RADIUS_KM   = 40;
const MAX_STRIKES = 500;

let strikes   = [];
let connected = false;
let lastSeen  = null;
let debugMsgs = [];
let totalReceived = 0;
let totalDecoded  = 0;

function haversine(lat1,lon1,lat2,lon2){
    const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function bearing(lat1,lon1,lat2,lon2){
    const dLon=(lon2-lon1)*Math.PI/180;
    const y=Math.sin(dLon)*Math.cos(lat2*Math.PI/180);
    const x=Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180)-Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos(dLon);
    return(Math.atan2(y,x)*180/Math.PI+360)%360;
}
const DIRS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
const PLACES=[
    {n:'La Tour-du-Pin',lat:45.573,lon:5.44},{n:'Bourgoin-Jallieu',lat:45.585,lon:5.27},
    {n:"L'Isle-d'Abeau",lat:45.617,lon:5.23},{n:'Morestel',lat:45.673,lon:5.467},
    {n:'Saint-Chef',lat:45.625,lon:5.39},{n:'Dolomieu',lat:45.607,lon:5.487},
    {n:'Crémieu',lat:45.73,lon:5.25},{n:'Vienne',lat:45.525,lon:4.875},
    {n:'Voiron',lat:45.365,lon:5.59},{n:'Pont-de-Beauvoisin',lat:45.535,lon:5.665},
    {n:'Belley',lat:45.76,lon:5.685},{n:'Ambérieu-en-Bugey',lat:45.96,lon:5.36},
    {n:'Grenoble',lat:45.188,lon:5.724},{n:'Chambéry',lat:45.564,lon:5.917},
    {n:'Bourg-en-Bresse',lat:46.205,lon:5.225},{n:'Aix-les-Bains',lat:45.688,lon:5.912},
    {n:'Lac de Paladru',lat:45.45,lon:5.52},{n:'Villefontaine',lat:45.61,lon:5.15},
    {n:'Meximieux',lat:45.906,lon:5.194},{n:'Forêt de Bonnevaux',lat:45.51,lon:5.2},
];
function nearestPlace(lat,lon){
    let best='Secteur local',bd=999;
    for(const p of PLACES){const d=Math.sqrt(Math.pow((lat-p.lat)*111,2)+Math.pow((lon-p.lon)*78,2));if(d<bd){bd=d;best=p.n;}}
    return bd<15?best:`${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`;
}

// ── Décodeur LZW Blitzortung (vrai algorithme) ────────────────
function lzwDecode(s) {
    const table = {};
    let prevEntry = String.fromCharCode(s.charCodeAt(0));
    let result = prevEntry;
    let charCode = 256;
    for (let i = 1; i < s.length; i++) {
        const code = s.charCodeAt(i);
        let entry;
        if (code < 256) {
            entry = String.fromCharCode(code);
        } else if (table[code]) {
            entry = table[code];
        } else {
            entry = prevEntry + prevEntry[0];
        }
        result += entry;
        table[charCode++] = prevEntry + entry[0];
        prevEntry = entry;
    }
    return result;
}

function decodeStrike(raw) {
    const str = raw.toString();
    
    // Essai 1 : JSON direct
    try {
        const d = JSON.parse(str);
        if (d && d.lat !== undefined) return d;
    } catch(e) {}
    
    // Essai 2 : décodage LZW puis JSON
    try {
        const decoded = lzwDecode(str);
        const d = JSON.parse(decoded);
        if (d && d.lat !== undefined) return d;
    } catch(e) {}
    
    // Essai 3 : le message est un Buffer binaire — essai comme LZW sur chars
    try {
        // Parfois Blitzortung envoie des données binaires WebSocket frame
        const decoded = lzwDecode(str);
        // Cherche un JSON dans la chaîne décodée
        const match = decoded.match(/\{.*\}/);
        if (match) {
            const d = JSON.parse(match[0]);
            if (d && d.lat !== undefined) return d;
        }
    } catch(e) {}

    return null;
}

// ── Connexion WebSocket Blitzortung ───────────────────────────
const SERVERS = ['ws1','ws2','ws3','ws4','ws5','ws6','ws7','ws8'];

function connectBlitzortung() {
    const server = SERVERS[Math.floor(Math.random()*SERVERS.length)];
    const url    = `wss://${server}.blitzortung.org`;
    console.log(`Connexion à ${url}...`);

    const ws = new WebSocket(url, {
        headers: { 'Origin': 'https://www.lightningmaps.org' }
    });

    ws.on('open', () => {
        console.log('WebSocket connecté !');
        connected = true;
        // Envoie la requête d'abonnement
        ws.send(JSON.stringify({ a: 111 }));
    });

    ws.on('message', (data) => {
        lastSeen  = new Date();
        totalReceived++;

        const strike = decodeStrike(data);
        
        if (!strike) return;
        
        totalDecoded++;

        // Support format avec location objet ou lat/lon directs
        const sLat = parseFloat(
            strike.lat ||
            (strike.location && strike.location.lat) ||
            (strike.loc && strike.loc[0]) || 0
        );
        const sLon = parseFloat(
            strike.lon ||
            (strike.location && strike.location.lon) ||
            (strike.loc && strike.loc[1]) || 0
        );
        const ts = strike.time
            ? Math.round(Number(strike.time) / 1e9)
            : Math.round(Date.now() / 1000);

        // Debug : garde trace des impacts décodés
        debugMsgs.unshift({
            ts: new Date().toISOString(),
            lat: sLat, lon: sLon,
            raw_sample: data.toString().slice(0,60)
        });
        if (debugMsgs.length > 10) debugMsgs = debugMsgs.slice(0,10);

        if (!sLat || !sLon || isNaN(sLat) || isNaN(sLon)) return;
        if (Math.abs(sLat) > 90 || Math.abs(sLon) > 180) return;

        const dist = haversine(CENTER_LAT,CENTER_LON,sLat,sLon);
        if (dist > RADIUS_KM) return;

        const brng  = bearing(CENTER_LAT,CENTER_LON,sLat,sLon);
        const dir   = DIRS[Math.round(brng/22.5)%16];
        const place = nearestPlace(sLat,sLon);
        const id    = `bz_${Math.round(sLat*1000)}_${Math.round(sLon*1000)}_${ts}`;

        if (strikes.find(s=>s.id===id)) return;

        const s = {
            id, ts,
            datetime: new Date(ts*1000).toISOString().replace('T',' ').slice(0,19),
            dist_km:  Math.round(dist*10)/10,
            bearing:  Math.round(brng*10)/10,
            dir, place,
            lat: Math.round(sLat*100000)/100000,
            lon: Math.round(sLon*100000)/100000,
            source: 'blitzortung',
            pol: strike.pol || 0,
        };

        strikes.unshift(s);
        if (strikes.length > MAX_STRIKES) strikes = strikes.slice(0, MAX_STRIKES);
        console.log(`⚡ IMPACT: ${place} · ${s.dist_km} km ${dir} · ${s.datetime}`);
    });

    ws.on('close', () => {
        connected = false;
        console.log('Déconnecté — reconnexion dans 5s...');
        setTimeout(connectBlitzortung, 5000);
    });

    ws.on('error', (err) => {
        connected = false;
        console.error('Erreur WS:', err.message);
    });
}

// ── API REST ──────────────────────────────────────────────────
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');next();});

app.get('/',(req,res)=>res.end(JSON.stringify({name:'Blitzortung Proxy',version:'2.0',endpoints:['/strikes','/health','/debug']})));

app.get('/health',(req,res)=>res.end(JSON.stringify({
    status:'ok', connected, last_seen:lastSeen,
    total_strikes:strikes.length,
    total_received:totalReceived,
    total_decoded:totalDecoded,
})));

app.get('/debug',(req,res)=>res.end(JSON.stringify({
    connected, last_seen:lastSeen,
    total_received:totalReceived,
    total_decoded:totalDecoded,
    total_strikes:strikes.length,
    recent_decoded:debugMsgs,
},null,2)));

app.get('/strikes',(req,res)=>{
    const now=Date.now()/1000;
    const minutes=parseInt(req.query.minutes)||60;
    const filtered=strikes.filter(s=>(now-s.ts)<=minutes*60);
    const today=new Date().toISOString().slice(0,10);
    const month=new Date().toISOString().slice(0,7);
    const year=new Date().getFullYear().toString();
    res.end(JSON.stringify({
        status:'ok', source:'blitzortung.org',
        center:{lat:CENTER_LAT,lon:CENTER_LON,name:'Sérezin-de-la-Tour'},
        radius_km:RADIUS_KM, generated:new Date().toISOString(),
        connected, last_seen:lastSeen,
        counts:{
            today:strikes.filter(s=>s.datetime.startsWith(today)).length,
            this_month:strikes.filter(s=>s.datetime.startsWith(month)).length,
            this_year:strikes.filter(s=>s.datetime.startsWith(year)).length,
            total:strikes.length,
        },
        last_strike:strikes[0]||null,
        lightnings:filtered,
    }));
});

// ── Keep-alive ────────────────────────────────────────────────
const https = require('https');
function keepAlive(){
    const url=process.env.RENDER_EXTERNAL_URL||'https://blitzortung-proxy.onrender.com';
    https.get(url+'/health',()=>{}).on('error',()=>{});
}

app.listen(PORT,'0.0.0.0',()=>{
    console.log('Serveur démarré sur port '+PORT);
    connectBlitzortung();
    setInterval(keepAlive,10*60*1000);
    setTimeout(keepAlive,60*1000);
});
