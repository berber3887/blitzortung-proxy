const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3000;

const CENTER_LAT  = 45.57;
const CENTER_LON  = 5.52;
const RADIUS_KM   = 40;
const MAX_STRIKES = 500;

let strikes   = [];
let connected = false;
let lastSeen  = null;
let lastRaw   = null;
let debugMsgs = [];

function haversine(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2-lat1)*Math.PI/180;
    const dLon = (lon2-lon1)*Math.PI/180;
    const a    = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function bearing(lat1,lon1,lat2,lon2) {
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
    {n:'Champier',lat:45.47,lon:5.33},{n:'Montalieu-Vercieu',lat:45.82,lon:5.41},
    {n:'Belley',lat:45.76,lon:5.685},{n:'Ambérieu-en-Bugey',lat:45.96,lon:5.36},
    {n:'Grenoble',lat:45.188,lon:5.724},{n:'Chambéry',lat:45.564,lon:5.917},
    {n:'Bourg-en-Bresse',lat:46.205,lon:5.225},{n:'Aix-les-Bains',lat:45.688,lon:5.912},
    {n:'Lac de Paladru',lat:45.45,lon:5.52},{n:'Villefontaine',lat:45.61,lon:5.15},
    {n:'Tignieu-Jameyzieu',lat:45.73,lon:5.17},{n:'Pont-de-Chéruy',lat:45.75,lon:5.17},
    {n:'Meximieux',lat:45.906,lon:5.194},{n:'Forêt de Bonnevaux',lat:45.51,lon:5.2},
];

function nearestPlace(lat,lon) {
    let best='Secteur local',bd=999;
    for(const p of PLACES){const d=Math.sqrt(Math.pow((lat-p.lat)*111,2)+Math.pow((lon-p.lon)*78,2));if(d<bd){bd=d;best=p.n;}}
    return bd<15?best:`${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`;
}

// ── Connexion Blitzortung via package npm ─────────────────────
function connectBlitzortung() {
    try {
        const { Client } = require('blitzortung');
        const WebSocket  = require('ws');

        const client = new Client({
            make(address) { return new WebSocket(address); }
        });

        client.connect();
        connected = true;

        client.on('error', (err) => {
            console.error('Erreur Blitzortung:', err.message);
            connected = false;
            setTimeout(connectBlitzortung, 5000);
        });

        client.on('data', (strike) => {
            lastSeen = new Date();
            connected = true;

            // Debug
            lastRaw = JSON.stringify(strike).slice(0,200);
            debugMsgs.unshift({ ts: new Date().toISOString(), strike: JSON.stringify(strike).slice(0,150) });
            if (debugMsgs.length > 5) debugMsgs = debugMsgs.slice(0,5);

            const sLat = strike.location ? strike.location.lat : (strike.lat || 0);
            const sLon = strike.location ? strike.location.lon : (strike.lon || 0);
            const ts   = strike.time ? Math.round(strike.time/1e9) : Math.round(Date.now()/1000);

            if (!sLat || !sLon || isNaN(sLat) || isNaN(sLon)) return;

            console.log(`Reçu: lat=${sLat} lon=${sLon}`);

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
            if(strikes.length>MAX_STRIKES) strikes=strikes.slice(0,MAX_STRIKES);
            console.log(`⚡ IMPACT: ${place} · ${s.dist_km} km ${dir}`);
        });

        console.log('Client Blitzortung connecté via package npm');

    } catch(e) {
        console.error('Package blitzortung non disponible:', e.message);
        connected = false;
        setTimeout(connectBlitzortung, 10000);
    }
}

// ── API ───────────────────────────────────────────────────────
app.use(function(req,res,next){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json; charset=utf-8');next();});

app.get('/', function(req,res){res.end(JSON.stringify({name:'Blitzortung Proxy',version:'2.0',endpoints:['/strikes','/health','/debug']}));});

app.get('/health', function(req,res){res.end(JSON.stringify({status:'ok',connected,last_seen:lastSeen,total_strikes:strikes.length}));});

app.get('/debug', function(req,res){res.end(JSON.stringify({connected,last_seen:lastSeen,total_strikes:strikes.length,last_decoded:lastRaw,recent_strikes:debugMsgs},null,2));});

app.get('/strikes', function(req,res){
    const now=Date.now()/1000;
    const minutes=parseInt(req.query.minutes)||60;
    const filtered=strikes.filter(s=>(now-s.ts)<=minutes*60);
    const today=new Date().toISOString().slice(0,10);
    const month=new Date().toISOString().slice(0,7);
    const year=new Date().getFullYear().toString();
    res.end(JSON.stringify({
        status:'ok',source:'blitzortung.org',
        center:{lat:CENTER_LAT,lon:CENTER_LON,name:'Sérezin-de-la-Tour'},
        radius_km:RADIUS_KM,generated:new Date().toISOString(),
        connected,last_seen:lastSeen,
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
    https.get(url+'/health',(res)=>{console.log(`Keep-alive OK (${res.statusCode})`);}).on('error',()=>{});
}

app.listen(PORT,'0.0.0.0',function(){
    console.log('Serveur démarré sur port '+PORT);
    connectBlitzortung();
    setInterval(keepAlive,10*60*1000);
    setTimeout(keepAlive,60*1000);
});
