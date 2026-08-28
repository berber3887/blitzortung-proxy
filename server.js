const WebSocket = require('ws');
const express   = require('express');
const https     = require('https');
const app       = express();
const PORT      = process.env.PORT || 3000;

const CENTER_LAT    = 45.5509;
const CENTER_LON    = 5.3407;
const RADIUS_KM     = 15;
const MAX_STRIKES   = 2000;
const XW_CLIENT_ID  = 'EiJ0yyGgMdCgqQxEQIOG4';
const XW_SECRET     = 'iyBYzEHfs9h4Gdm0MNSNaAkK3IeycD5z9pacFlZP';

let strikes       = [];
let connected     = false;
let lastSeen      = null;
let totalReceived = 0;
let totalDecoded  = 0;
let xwLastFetch   = 0;

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
    {n:'Sérezin-de-la-Tour',        lat:45.5554,lon:5.3483},
    {n:'Cessieu',                    lat:45.5694,lon:5.3746},
    {n:'Succieu',                    lat:45.5285,lon:5.3416},
    {n:'Saint-Victor-de-Cessieu',   lat:45.5379,lon:5.3814},
    {n:'Nivolas-Vermelle',           lat:45.5638,lon:5.3084},
    {n:'Ruy-Montceau',               lat:45.5881,lon:5.3482},
    {n:'Châteauvilain',              lat:45.5142,lon:5.3318},
    {n:'Les Éparres',                lat:45.5371,lon:5.2908},
    {n:'Meyrié',                     lat:45.5606,lon:5.2834},
    {n:'Torchefelon',                lat:45.5172,lon:5.3984},
    {n:'Rochetoirin',                lat:45.5854,lon:5.4140},
    {n:'Biol',                       lat:45.4971,lon:5.3674},
    {n:'Sainte-Blandine',            lat:45.5450,lon:5.4360},
    {n:'Maubec',                     lat:45.5677,lon:5.2583},
    {n:'Montcarra',                  lat:45.6091,lon:5.4017},
    {n:'Eclose-Badinières',          lat:45.4998,lon:5.2987},
    {n:'Saint-Jean-de-Soudain',      lat:45.5842,lon:5.4350},
    {n:'Bourgoin-Jallieu',           lat:45.6025,lon:5.2747},
    {n:'Tramolé',                    lat:45.5153,lon:5.2656},
    {n:'La Tour-du-Pin',             lat:45.5743,lon:5.4459},
    {n:'Domarin',                    lat:45.5827,lon:5.2491},
    {n:'Saint-Savin',                lat:45.6282,lon:5.3216},
    {n:'Culin',                      lat:45.5215,lon:5.2493},
    {n:'Doissin',                    lat:45.4990,lon:5.4248},
    {n:'Montagnieu',                 lat:45.5268,lon:5.4549},
    {n:'Saint-Agnin-sur-Bion',       lat:45.5370,lon:5.2360},
    {n:'Belmont',                    lat:45.4724,lon:5.3602},
    {n:'Saint-Chef',                 lat:45.6401,lon:5.3619},
    {n:'Flachères',                  lat:45.4686,lon:5.3159},
    {n:'Montrevel',                  lat:45.4764,lon:5.4095},
    {n:'Crachier',                   lat:45.5462,lon:5.2194},
    {n:'Vignieu',                    lat:45.6315,lon:5.4227},
    {n:'Saint-Alban-de-Roche',       lat:45.5889,lon:5.2243},
    {n:'Chèzeneuve',                 lat:45.5617,lon:5.2151},
    {n:'Saint-Didier-de-Bizonnes',   lat:45.4599,lon:5.3437},
    {n:'Sainte-Anne-sur-Gervonde',   lat:45.4998,lon:5.2354},
    {n:'Saint-Clair-de-la-Tour',     lat:45.5717,lon:5.4863},
    {n:'La Chapelle-de-la-Tour',     lat:45.5913,lon:5.4788},
    {n:'Saint-Didier-de-la-Tour',    lat:45.5446,lon:5.4877},
    {n:'Vasselin',                   lat:45.6293,lon:5.4504},
    {n:'Chélieu',                    lat:45.5046,lon:5.4771},
    {n:'Blandin',                    lat:45.4791,lon:5.4487},
    {n:"L'Isle-d'Abeau",             lat:45.6153,lon:5.2234},
    {n:'Champier',                   lat:45.4578,lon:5.2861},
    {n:'Four',                       lat:45.5726,lon:5.1960},
    {n:'Dolomieu',                   lat:45.6179,lon:5.4759},
    {n:'Bizonnes',                   lat:45.4480,lon:5.3777},
    {n:'Meyrieu-les-Étangs',         lat:45.5156,lon:5.2014},
    {n:'Eydoche',                    lat:45.4439,lon:5.3355},
    {n:'Vénérieu',                   lat:45.6593,lon:5.2785},
    {n:'Saint-Sorlin-de-Morestel',   lat:45.6320,lon:5.4716},
    {n:'Salagnon',                   lat:45.6717,lon:5.3523},
    {n:'Châtonnay',                  lat:45.4784,lon:5.2225},
    {n:'Val-de-Virieu',              lat:45.4760,lon:5.4716},
    {n:'Saint-Marcel-Bel-Accueil',   lat:45.6502,lon:5.2419},
    {n:'Le Passage',                 lat:45.5265,lon:5.5157},
    {n:'Châbons',                    lat:45.4477,lon:5.4280},
    {n:'Faverges-de-la-Tour',        lat:45.5952,lon:5.5121},
    {n:'La Bâtie-Montgascon',         lat:45.6080,lon:5.4500},
    {n:'Sermérieu',                  lat:45.6689,lon:5.4123},
    {n:'Artas',                      lat:45.5385,lon:5.1676},
    {n:'Chassignieu',                lat:45.5014,lon:5.5138},
    {n:'Saint-Hilaire-de-Brens',     lat:45.6770,lon:5.2913},
    {n:'Vaulx-Milieu',               lat:45.6174,lon:5.1868},
    {n:'Vézeronce-Curtin',           lat:45.6534,lon:5.4690},
    {n:'Saint-André-le-Gaz',         lat:45.5477,lon:5.5336},
    {n:'Longechenal',                lat:45.4238,lon:5.3618},
    {n:'Trept',                      lat:45.6864,lon:5.3239},
];

function nearestPlace(lat,lon){
    let best='Secteur local',bd=999;
    for(const p of PLACES){
        const d=Math.sqrt(Math.pow((lat-p.lat)*111,2)+Math.pow((lon-p.lon)*78,2));
        if(d<bd){bd=d;best=p.n;}
    }
    return bd<20?best:`${lat.toFixed(3)}N ${lon.toFixed(3)}E`;
}

// Intensité basée sur kA réels (Xweather) ou mds (Blitzortung fallback)
function getIntensity(kA){
    const absKa = Math.abs(kA||0);
    if(absKa===0)  return{level:0,label:'Inconnue',  icon:'⚡',       desc:'Données indisponibles'};
    if(absKa<10)   return{level:1,label:'Faible',     icon:'⚡',       desc:`${absKa} kA · Décharge légère`};
    if(absKa<40)   return{level:2,label:'Modérée',    icon:'⚡⚡',     desc:`${absKa} kA · Décharge moyenne`};
    if(absKa<100)  return{level:3,label:'Forte',      icon:'⚡⚡⚡',   desc:`${absKa} kA · Décharge assez forte`};
    if(absKa<200)  return{level:4,label:'Très forte', icon:'⚡⚡⚡⚡', desc:`${absKa} kA · Décharge majeure`};
    return             {level:4,label:'Exceptionnelle',icon:'⚡⚡⚡⚡',desc:`${absKa} kA · Superbolt !`};
}

function getMdsIntensity(mds){
    if(!mds||mds<=0) return{level:0,label:'Inconnue',  icon:'⚡',       desc:'Données indisponibles'};
    if(mds<1000)     return{level:1,label:'Faible',     icon:'⚡',       desc:'Décharge légère'};
    if(mds<5000)     return{level:2,label:'Modérée',    icon:'⚡⚡',     desc:'Décharge moyenne'};
    if(mds<15000)    return{level:3,label:'Forte',      icon:'⚡⚡⚡',   desc:'Décharge assez forte'};
    return               {level:4,label:'Très forte',   icon:'⚡⚡⚡⚡', desc:'Décharge majeure'};
}

function toParisDatetime(ts){
    return new Date(ts*1000).toLocaleString('fr-FR',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).replace(/(\d{2})\/(\d{2})\/(\d{4}),?\s/,'$3-$2-$1 ');
}
function toParisDate(ts){
    return new Date(ts*1000).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).replace(/(\d{2})\/(\d{2})\/(\d{4})/,'$3-$2-$1');
}
function toParisMonth(ts){
    const d=new Date(ts*1000);
    const y=d.toLocaleDateString('fr-FR',{timeZone:'Europe/Paris',year:'numeric'}).replace(/.*(\d{4}).*/,'$1');
    const m=d.toLocaleDateString('fr-FR',{timeZone:'Europe/Paris',month:'2-digit'}).replace(/.*(\d{2}).*/,'$1');
    return y+'-'+m;
}

// ── Xweather API — vrais kA ───────────────────────────────────
function fetchXweather(){
    const now = Date.now();
    if(now - xwLastFetch < 2*60*1000) return; // max 1 appel par 2 min pendant orage
    xwLastFetch = now;
    console.log('[Xweather] Appel déclenché par impact Blitzortung...');

    const url = `https://api.aerisapi.com/lightning/${CENTER_LAT},${CENTER_LON}?radius=${RADIUS_KM}km&limit=100&client_id=${XW_CLIENT_ID}&client_secret=${XW_SECRET}`;

    https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                if(!json.success || !json.response) return;

                const list = Array.isArray(json.response) ? json.response : [json.response];
                let newCount = 0;

                list.forEach(item => {
                    if(!item.ob) return;
                    const ob  = item.ob;
                    const loc = item.loc;
                    if(!loc || !loc.lat || !loc.long) return;

                    const sLat = parseFloat(loc.lat);
                    const sLon = parseFloat(loc.long);
                    const ts   = ob.timestamp || Math.round(Date.now()/1000);

                    // Extraction kA — différents noms de champs possibles selon version API
                    let kARaw = 0;
                    if (ob.pulse) {
                        kARaw = ob.pulse.peakamp || ob.pulse.peakAmp || ob.pulse.peakCurrent || 0;
                    } else if (ob.peakamp) {
                        kARaw = ob.peakamp;
                    } else if (ob.peakAmp) {
                        kARaw = ob.peakAmp;
                    }
                    // La valeur est en Ampères si > 1000, sinon peut être en kA directement
                    const kA = Math.abs(kARaw) > 1000 ? Math.round(Math.abs(kARaw)/1000) : Math.round(Math.abs(kARaw));
                    const pol  = kARaw >= 0 ? 1 : -1;
                    const type = ob.pulse ? (ob.pulse.type||'cg') : (ob.type||'cg');

                    const dist  = haversine(CENTER_LAT,CENTER_LON,sLat,sLon);
                    if(dist > RADIUS_KM) return;

                    const brng  = bearing(CENTER_LAT,CENTER_LON,sLat,sLon);
                    const dir   = DIRS[Math.round(brng/22.5)%16];
                    const place = nearestPlace(sLat,sLon);
                    const intensity = getIntensity(kA);
                    const typeLabel = (type==='cg'||type==='cloud-to-ground') ? 'Nuage-sol' : 'Intra-nuageux';

                    // Cherche un impact Blitzortung existant proche (même zone, ±60s)
                    let matched = false;
                    for (let i = 0; i < strikes.length; i++) {
                        const s = strikes[i];
                        const timeDiff = Math.abs(s.ts - ts);
                        const distDiff = haversine(s.lat, s.lon, sLat, sLon);
                        if (timeDiff < 60 && distDiff < 2) {
                            // Mise à jour du kA sur l'impact existant
                            if (kA > 0) {
                                strikes[i].ka              = kA;
                                strikes[i].pol             = pol;
                                strikes[i].type            = typeLabel;
                                strikes[i].intensity_level = intensity.level;
                                strikes[i].intensity_label = intensity.label;
                                strikes[i].intensity_icon  = intensity.icon;
                                strikes[i].intensity_desc  = intensity.desc;
                                console.log(`⚡ [Xweather] MAJ kA: ${strikes[i].place} · ${kA}kA · ${intensity.icon}`);
                            }
                            matched = true;
                            newCount++;
                            break;
                        }
                    }

                    // Si pas de correspondance, ajoute comme nouveau
                    if (!matched) {
                        const id = `xw_${Math.round(sLat*10000)}_${Math.round(sLon*10000)}_${ts}`;
                        if (strikes.find(s=>s.id===id)) return;
                        const s = {
                            id, ts,
                            datetime: toParisDatetime(ts),
                            dist_km:  Math.round(dist*10)/10,
                            bearing:  Math.round(brng*10)/10,
                            dir, place,
                            lat: Math.round(sLat*100000)/100000,
                            lon: Math.round(sLon*100000)/100000,
                            source: 'xweather',
                            ka: kA, pol,
                            type: typeLabel,
                            intensity_level: intensity.level,
                            intensity_label: intensity.label,
                            intensity_icon:  intensity.icon,
                            intensity_desc:  intensity.desc,
                        };
                        strikes.unshift(s);
                        newCount++;
                        console.log(`⚡ [Xweather] Nouveau: ${place} · ${dist.toFixed(1)}km ${dir} · ${kA}kA`);
                    }
                });

                if(strikes.length > MAX_STRIKES) strikes = strikes.slice(0, MAX_STRIKES);
                if(newCount > 0) console.log(`Xweather: ${newCount} nouveaux impacts`);

            } catch(e) { console.error('Xweather parse error:', e.message); }
        });
    }).on('error', e => console.error('Xweather fetch error:', e.message));
}

// ── Blitzortung WebSocket (fallback + complément) ─────────────
function lzwDecode(s){
    const table={};
    let prev=String.fromCharCode(s.charCodeAt(0)),result=prev,code=256;
    for(let i=1;i<s.length;i++){
        const c=s.charCodeAt(i);
        let entry;
        if(c<256)entry=String.fromCharCode(c);
        else if(table[c])entry=table[c];
        else entry=prev+prev[0];
        result+=entry;table[code++]=prev+entry[0];prev=entry;
    }
    return result;
}

function extractNum(src,key){
    const idx=src.indexOf('"'+key);
    if(idx===-1)return null;
    let i=idx+key.length+1;
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

function decodeStrike(raw){
    const str=raw.toString();
    try{const d=JSON.parse(str);if(d&&d.lat!==undefined)return d;}catch(e){}
    try{const decoded=lzwDecode(str);const d=JSON.parse(decoded);if(d&&d.lat!==undefined)return d;}catch(e){}
    try{
        const lat=extractNum(str,'lat'),lon=extractNum(str,'lon');
        const time=extractNum(str,'time'),pol=extractNum(str,'pol');
        const mds=extractNum(str,'mds'),mcg=extractNum(str,'mcg');
        if(lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180){
            return{time:time||Date.now()*1000000,lat,lon,pol:pol||0,mds:mds||0,mcg:mcg||0};
        }
    }catch(e){}
    return null;
}

const SERVERS=['ws1','ws2','ws3','ws4','ws5','ws6','ws7','ws8'];
function connectBlitzortung(){
    const server=SERVERS[Math.floor(Math.random()*SERVERS.length)];
    const url=`wss://${server}.blitzortung.org`;
    console.log(`Connexion Blitzortung à ${url}...`);
    const ws=new WebSocket(url,{headers:{'Origin':'https://www.lightningmaps.org'}});
    ws.on('open',()=>{console.log('Blitzortung connecté !');connected=true;ws.send(JSON.stringify({a:111}));});
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

        // Déclenche Xweather après 15s — laisse le temps au réseau BLIDS de traiter l'impact
        setTimeout(fetchXweather, 15000);

        const brng=bearing(CENTER_LAT,CENTER_LON,sLat,sLon);
        const dir=DIRS[Math.round(brng/22.5)%16];
        const place=nearestPlace(sLat,sLon);
        const id=`bz_${Math.round(sLat*1000)}_${Math.round(sLon*1000)}_${ts}`;
        if(strikes.find(s=>s.id===id)) return;

        const mds=Math.round(strike.mds||0);
        const pol=strike.pol||0;
        const intensity=getMdsIntensity(mds);
        const s={
            id,ts,datetime:toParisDatetime(ts),
            dist_km:Math.round(dist*10)/10,
            bearing:Math.round(brng*10)/10,
            dir,place,
            lat:Math.round(sLat*100000)/100000,
            lon:Math.round(sLon*100000)/100000,
            source:'blitzortung',
            ka:0, pol, mds,
            type:'Nuage-sol',
            intensity_level:intensity.level,
            intensity_label:intensity.label,
            intensity_icon:intensity.icon,
            intensity_desc:intensity.desc,
        };
        strikes.unshift(s);
        if(strikes.length>MAX_STRIKES)strikes=strikes.slice(0,MAX_STRIKES);
        console.log(`⚡ [Blitz] ${place} · ${s.dist_km}km ${dir} · ${intensity.icon} (mds=${mds})`);
    });
    ws.on('close',()=>{connected=false;console.log('Blitzortung déconnecté — reconnexion 5s...');setTimeout(connectBlitzortung,5000);});
    ws.on('error',(err)=>{connected=false;console.error('Erreur Blitzortung:',err.message);});
}

// ── API REST ──────────────────────────────────────────────────
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');next();});

app.get('/',(req,res)=>res.end(JSON.stringify({name:'Lightning Proxy — Sérezin 15km',version:'5.0',sources:['Xweather (kA réels)','Blitzortung (temps réel)'],endpoints:['/strikes','/health','/debug']})));

app.get('/health',(req,res)=>res.end(JSON.stringify({status:'ok',connected,last_seen:lastSeen,total_strikes:strikes.length,total_received:totalReceived,total_decoded:totalDecoded})));

app.get('/debug',(req,res)=>res.end(JSON.stringify({connected,last_seen:lastSeen,total_received:totalReceived,total_decoded:totalDecoded,total_strikes:strikes.length,last_5:strikes.slice(0,5)},null,2)));

app.get('/strikes',(req,res)=>{
    const now=Date.now()/1000;
    const minutes=parseInt(req.query.minutes)||360;
    const limit=parseInt(req.query.limit)||5;
    const filtered=strikes.filter(s=>(now-s.ts)<=minutes*60);
    const todayParis=toParisDate(now);
    const monthParis=todayParis.slice(0,7);
    const yearParis=todayParis.slice(0,4);
    res.end(JSON.stringify({
        status:'ok',
        source:'Xweather (kA réels) + Blitzortung (temps réel)',
        center:{lat:CENTER_LAT,lon:CENTER_LON,name:'Sérezin-de-la-Tour'},
        radius_km:RADIUS_KM,generated:new Date().toISOString(),
        connected,last_seen:lastSeen,
        counts:{
            today:  strikes.filter(s=>toParisDate(s.ts)===todayParis).length,
            this_month:strikes.filter(s=>toParisMonth(s.ts)===monthParis).length,
            this_year: strikes.filter(s=>toParisDate(s.ts).startsWith(yearParis)).length,
            total:strikes.length,
        },
        last_strike:strikes[0]||null,
        last_5:strikes.slice(0,5),
        lightnings:filtered.slice(0,limit),
    }));
});

// ── Keep-alive ────────────────────────────────────────────────
function keepAlive(){
    const url=process.env.RENDER_EXTERNAL_URL||'https://blitzortung-proxy.onrender.com';
    https.get(url+'/health',()=>{}).on('error',()=>{});
}

app.listen(PORT,'0.0.0.0',()=>{
    console.log(`Serveur démarré port ${PORT}`);
    connectBlitzortung();
    // Keep-alive toutes les 10 min uniquement
    setInterval(keepAlive, 10*60*1000);
    setTimeout(keepAlive, 60*1000);
    console.log('Xweather : appel uniquement sur détection impact Blitzortung dans les 15km');
});
