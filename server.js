const WebSocket = require('ws');
const express   = require('express');
const app       = express();
const PORT      = process.env.PORT || 3000;

const CENTER_LAT  = 45.5509;
const CENTER_LON  = 5.3407;
const RADIUS_KM   = 15;       // réduit à 15 km
const MAX_STRIKES = 2000;     // augmenté à 2000

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

// Lieux corrigés avec vraies coordonnées
const PLACES=[
    {n:'Sérezin-de-la-Tour',  lat:45.5509,lon:5.3407},
    {n:'La Tour-du-Pin',      lat:45.5736,lon:5.4414},  // EST de Sérezin
    {n:'Bourgoin-Jallieu',    lat:45.5853,lon:5.2686},
    {n:"L'Isle-d'Abeau",      lat:45.6167,lon:5.2333},
    {n:'Morestel',            lat:45.6728,lon:5.4669},
    {n:'Saint-Chef',          lat:45.6253,lon:5.3897},
    {n:'Dolomieu',            lat:45.6072,lon:5.4875},
    {n:'Crémieu',             lat:45.7303,lon:5.2536},
    {n:'Vienne',              lat:45.5253,lon:4.8753},
    {n:'Voiron',              lat:45.3653,lon:5.5903},
    {n:'Pont-de-Beauvoisin',  lat:45.5353,lon:5.6653},
    {n:'Champier',            lat:45.4703,lon:5.3303},
    {n:'Montalieu-Vercieu',   lat:45.8203,lon:5.4103},
    {n:'Belley',              lat:45.7603,lon:5.6853},
    {n:'Ambérieu-en-Bugey',   lat:45.9603,lon:5.3603},
    {n:'Grenoble',            lat:45.1883,lon:5.7243},
    {n:'Chambéry',            lat:45.5643,lon:5.9173},
    {n:'Bourg-en-Bresse',     lat:46.2053,lon:5.2253},
    {n:'Aix-les-Bains',       lat:45.6883,lon:5.9123},
    {n:'Lac de Paladru',      lat:45.4503,lon:5.5203},
    {n:'Villefontaine',       lat:45.6103,lon:5.1503},
    {n:'Tignieu-Jameyzieu',   lat:45.7303,lon:5.1703},
    {n:'Meximieux',           lat:45.9063,lon:5.1943},
    {n:'Forêt de Bonnevaux',  lat:45.5103,lon:5.2003},
    {n:'Pont-de-Chéruy',      lat:45.7503,lon:5.1703},
];

function nearestPlace(lat,lon){
    let best='Secteur local',bd=999;
    for(const p of PLACES){
        const d=Math.sqrt(Math.pow((lat-p.lat)*111,2)+Math.pow((lon-p.lon)*78,2));
        if(d<bd){bd=d;best=p.n;}
    }
    return bd<12?best:`${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`;
}

// Convertit timestamp en heure Paris
function toParisDatetime(ts) {
    const d = new Date(ts * 1000);
    // Format YYYY-MM-DD HH:MM:SS en heure Paris
    return d.toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).replace(/(\d{2})\/(\d{2})\/(\d{4}),?\s/, '$3-$2-$1 ');
}

function toParisDate(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
        .replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
}

function toParisMonth(ts) {
    const d = new Date(ts * 1000);
    const y = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric' });
    const m = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', month: '2-digit' });
    return y.replace(/.*(\d{4}).*/, '$1') + '-' + m.replace(/.*(\d{2}).*/, '$1');
}

// Décodeur LZW Blitzortung
function lzwDecode(s) {
    const table = {};
    let prevEntry = String.fromCharCode(s.charCodeAt(0));
    let result = prevEntry;
    let charCode = 256;
    for (let i = 1; i < s.length; i++) {
        const code = s.charCodeAt(i);
        let entry;
        if (code < 256) entry = String.fromCharCode(code);
        else if (table[code]) entry = table[code];
        else entry = prevEntry + prevEntry[0];
        result += entry;
        table[charCode++] = prevEntry + entry[0];
        prevEntry = entry;
    }
    return result;
}

function decodeStrike(raw) {
    const str = raw.toString();
    try { const d=JSON.parse(str); if(d&&d.lat!==undefined)return d; } catch(e){}
    try { const decoded=lzwDecode(str); const d=JSON.parse(decoded); if(d&&d.lat!==undefined)return d; } catch(e){}
    try {
        function extractNum(src,key){
            const keyIdx=src.indexOf('"'+key);
            if(keyIdx===-1)return null;
            let i=keyIdx+key.length+1;
            while(i<src.length&&src[i]!==':')i++;
            i++;
            let num='',hasSign=false,hasDecimal=false,hasDigit=false;
            const end=Math.min(i+30,src.length);
            for(let j=i;j<end;j++){
                const c=src[j],code=src.charCodeAt(j);
                if(code>127)continue;
                if(c==='-'&&!hasSign&&!hasDigit){num+=c;hasSign=true;}
                else if(c>='0'&&c<='9'){num+=c;hasDigit=true;}
                else if(c==='.'&&!hasDecimal&&hasDigit){num+=c;hasDecimal=true;}
                else if(hasDigit&&(c===','||c==='"'||c==='}'||c===' '))break;
                else if(hasDigit&&code<32)break;
            }
            if(!hasDigit)return null;
            const val=parseFloat(num);
            return isNaN(val)?null:val;
        }
        const lat=extractNum(str,'lat'),lon=extractNum(str,'lon');
        const time=extractNum(str,'time'),pol=extractNum(str,'pol');
        if(lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180){
            return{time:time||Date.now()*1000000,lat,lon,pol:pol||0};
        }
    } catch(e){}
    return null;
}

// Connexion WebSocket
const SERVERS=['ws1','ws2','ws3','ws4','ws5','ws6','ws7','ws8'];
function connectBlitzortung(){
    const server=SERVERS[Math.floor(Math.random()*SERVERS.length)];
    const url=`wss://${server}.blitzortung.org`;
    console.log(`Connexion à ${url}...`);
    const ws=new WebSocket(url,{headers:{'Origin':'https://www.lightningmaps.org'}});
    ws.on('open',()=>{console.log('Connecté !');connected=true;ws.send(JSON.stringify({a:111}));});
    ws.on('message',(data)=>{
        lastSeen=new Date();totalReceived++;
        const strike=decodeStrike(data);
        if(!strike)return;
        totalDecoded++;
        const sLat=parseFloat(strike.lat||(strike.location&&strike.location.lat)||0);
        const sLon=parseFloat(strike.lon||(strike.location&&strike.location.lon)||0);
        const ts=strike.time?Math.round(Number(strike.time)/1e9):Math.round(Date.now()/1000);
        if(!sLat||!sLon||isNaN(sLat)||isNaN(sLon))return;
        if(Math.abs(sLat)>90||Math.abs(sLon)>180)return;
        const dist=haversine(CENTER_LAT,CENTER_LON,sLat,sLon);
        if(dist>RADIUS_KM)return;
        const brng=bearing(CENTER_LAT,CENTER_LON,sLat,sLon);
        const dir=DIRS[Math.round(brng/22.5)%16];
        const place=nearestPlace(sLat,sLon);
        const id=`bz_${Math.round(sLat*1000)}_${Math.round(sLon*1000)}_${ts}`;
        if(strikes.find(s=>s.id===id))return;
        const datetimeParis=toParisDatetime(ts);
        const s={id,ts,datetime:datetimeParis,dist_km:Math.round(dist*10)/10,bearing:Math.round(brng*10)/10,dir,place,lat:Math.round(sLat*100000)/100000,lon:Math.round(sLon*100000)/100000,source:'blitzortung',pol:strike.pol||0};
        strikes.unshift(s);
        if(strikes.length>MAX_STRIKES)strikes=strikes.slice(0,MAX_STRIKES);
        console.log(`⚡ ${place} · ${s.dist_km} km ${dir} · ${datetimeParis}`);
    });
    ws.on('close',()=>{connected=false;console.log('Déconnecté — reconnexion 5s...');setTimeout(connectBlitzortung,5000);});
    ws.on('error',(err)=>{connected=false;console.error('Erreur:',err.message);});
}

// API REST
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');next();});
app.get('/',(req,res)=>res.end(JSON.stringify({name:'Blitzortung Proxy 15km',version:'3.0',endpoints:['/strikes','/health','/debug']})));
app.get('/health',(req,res)=>res.end(JSON.stringify({status:'ok',connected,last_seen:lastSeen,total_strikes:strikes.length,total_received:totalReceived,total_decoded:totalDecoded})));
app.get('/debug',(req,res)=>res.end(JSON.stringify({connected,last_seen:lastSeen,total_received:totalReceived,total_decoded:totalDecoded,total_strikes:strikes.length,recent_debug:debugMsgs},null,2)));

app.get('/strikes',(req,res)=>{
    const now=Date.now()/1000;
    const minutes=parseInt(req.query.minutes)||360;
    const limit=parseInt(req.query.limit)||5;
    const filtered=strikes.filter(s=>(now-s.ts)<=minutes*60);

    // Calcul dates en heure Paris
    const nowDate=new Date();
    const todayParis=nowDate.toLocaleDateString('fr-FR',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).replace(/(\d{2})\/(\d{2})\/(\d{4})/,'$3-$2-$1');
    const monthParis=todayParis.slice(0,7);
    const yearParis=todayParis.slice(0,4);

    res.end(JSON.stringify({
        status:'ok',source:'blitzortung.org',
        center:{lat:CENTER_LAT,lon:CENTER_LON,name:'Sérezin-de-la-Tour'},
        radius_km:RADIUS_KM,generated:new Date().toISOString(),
        connected,last_seen:lastSeen,
        counts:{
            today:  strikes.filter(s=>toParisDate(s.ts)===todayParis).length,
            this_month: strikes.filter(s=>toParisMonth(s.ts)===monthParis).length,
            this_year:  strikes.filter(s=>toParisDate(s.ts).startsWith(yearParis)).length,
            total:  strikes.length,
        },
        last_strike:strikes[0]||null,
        last_5:strikes.slice(0,5),
        lightnings:filtered.slice(0,limit),
    }));
});

// Keep-alive
const https=require('https');
function keepAlive(){
    const url=process.env.RENDER_EXTERNAL_URL||'https://blitzortung-proxy.onrender.com';
    https.get(url+'/health',()=>{}).on('error',()=>{});
}
app.listen(PORT,'0.0.0.0',()=>{
    console.log('Serveur démarré port '+PORT);
    connectBlitzortung();
    setInterval(keepAlive,10*60*1000);
    setTimeout(keepAlive,60*1000);
});
