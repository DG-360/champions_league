/* Weekly home-page spotlight generator.
   About one day before the first kickoff of each league-phase matchday, rank
   the week's fixtures by public interest, then publish three concise football
   notes. Ranking signals stay internal; the UI only receives human-readable
   matchup facts/news snippets. No extra API key is required. */

const ROOT = "cl2627";
const DB = (process.env.FIREBASE_DB_URL || "").trim().replace(/\/$/,"");
const FORCE = ["1","true"].includes(String(process.env.FORCE_SPOTLIGHT||"").toLowerCase());
const USER_AGENT = "ChampionsLeaguePredictor/2.0 (weekly home-page spotlight)";
const SPOTLIGHT_VERSION = 2;

if(!DB.startsWith("https://")) throw new Error("FIREBASE_DB_URL is missing");

async function getText(url){
  const r = await fetch(url,{headers:{"User-Agent":USER_AGENT,"Accept":"application/json,text/xml,application/rss+xml,text/plain,*/*"}});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.text();
}
async function getJson(url){ return JSON.parse(await getText(url)); }

const cleanHtml = s => String(s||"")
  .replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"')
  .replace(/&#x27;/g,"'").replace(/&nbsp;/g," ").replace(/<[^>]+>/g,"")
  .replace(/\s+/g," ").trim();
const teamName = (teams,c) => (teams[c] && (teams[c][0] || teams[c][1])) || c;

function isoDate(d){ return d.toISOString().slice(0,10).replaceAll("-",""); }
function wikiTitle(name){
  const map={
    "Man City":"Manchester_City_F.C.","Man Utd":"Manchester_United_F.C.","Paris":"Paris_Saint-Germain_F.C.",
    "Atleti":"Atlético_Madrid","Inter":"Inter_Milan","Dortmund":"Borussia_Dortmund","Bayern München":"FC_Bayern_Munich",
    "Sporting CP":"Sporting_CP","PSV":"PSV_Eindhoven","Slovan":"ŠK_Slovan_Bratislava","Shakhtar":"FC_Shakhtar_Donetsk",
    "Bodø/Glimt":"FK_Bodø/Glimt","Slavia Praha":"SK_Slavia_Prague","AEK Athens":"AEK_Athens_F.C.",
    "LASK":"LASK","Sabah":"Sabah_FC_(Azerbaijan)","Viking":"Viking_FK","Leipzig":"RB_Leipzig",
    "Club Brugge":"Club_Brugge_KV","Aston Villa":"Aston_Villa_F.C.","Real Betis":"Real_Betis",
    "Fenerbahçe":"Fenerbahçe_S.K._(football)","Galatasaray":"Galatasaray_S.K._(football)","Como":"Como_1907",
    "Lens":"RC_Lens","Lille":"Lille_OSC","Porto":"FC_Porto","Barcelona":"FC_Barcelona","Real Madrid":"Real_Madrid_CF",
    "Liverpool":"Liverpool_F.C.","Arsenal":"Arsenal_F.C.","Napoli":"SSC_Napoli","Feyenoord":"Feyenoord",
    "Roma":"AS_Roma","Villarreal":"Villarreal_CF","Stuttgart":"VfB_Stuttgart"
  };
  return map[name] || name.replaceAll(" ","_");
}

async function pageviews(name){
  try{
    const end = new Date(); end.setUTCDate(end.getUTCDate()-1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate()-6);
    const title = encodeURIComponent(wikiTitle(name));
    const url=`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/daily/${isoDate(start)}/${isoDate(end)}`;
    const j=await getJson(url);
    return (j.items||[]).reduce((s,x)=>s+(Number(x.views)||0),0);
  }catch(e){ return 0; }
}

function rssItems(xml){
  const blocks=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(x=>x[1]);
  return blocks.map(b=>({
    title:cleanHtml((b.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]),
    source:cleanHtml((b.match(/<source[^>]*>([\s\S]*?)<\/source>/i)||[])[1]),
    date:cleanHtml((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)||[])[1])
  })).filter(x=>x.title);
}

async function newsQuery(q){
  try{
    const xml=await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`);
    return rssItems(xml).slice(0,30);
  }catch(e){ return []; }
}

async function newsFor(home,away){
  const base=`"${home}" "${away}" Champions League`;
  const [general,teamNews,history]=await Promise.all([
    newsQuery(`${base} when:7d`),
    newsQuery(`${base} injury OR injured OR doubt OR suspended OR bench OR lineup OR manager OR rumour OR rumor when:7d`),
    newsQuery(`${base} head-to-head OR history OR record OR unbeaten OR wins when:30d`)
  ]);
  const seen=new Set(), out=[];
  for(const x of [...teamNews,...history,...general]){
    const k=x.title.toLowerCase();
    if(!seen.has(k)){seen.add(k);out.push(x);}
  }
  return out;
}

function scoreMatch(newsCount,views){ return newsCount*8 + Math.log10(Math.max(10,views))*12; }

function humanFact(item){
  if(!item?.title) return "";
  let s=cleanHtml(item.title);
  if(item.source){
    const src=item.source.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    s=s.replace(new RegExp(`\\s*[-–—|:]\\s*${src}\\s*$`,`i`),"");
  }
  s=s
    .replace(/^UEFA Champions League\s*[:\-–—]\s*/i,"")
    .replace(/^Champions League\s*[:\-–—]\s*/i,"")
    .replace(/\s*[-–—|]\s*(live|latest|updates?)\s*$/i,"")
    .replace(/\s+/g," ").trim();

  /* Turn obvious rumor wording into a natural, properly qualified note. */
  if(/\b(rumou?r|reportedly|reports? say|linked with|could|may|might)\b/i.test(s) && !/^Reports?:/i.test(s))
    s=`Reports: ${s.charAt(0).toLowerCase()+s.slice(1)}`;

  if(s.length>145){
    s=s.slice(0,142).replace(/\s+\S*$/,"").trim()+"…";
  }
  if(s && !/[.!?…]$/.test(s)) s+=".";
  return s;
}

function usefulTitle(title){
  const s=String(title||"").toLowerCase();
  if(!s) return false;
  const lowValue=/how to watch|live stream|tv channel|kick.?off time|tickets|odds|betting|prediction|predicted lineup|where to watch/;
  return !lowValue.test(s);
}

function selectFacts(news){
  const priority=/injur|doubt|suspend|bench|manager|coach|rumou?r|report|record|history|head.?to.?head|unbeaten|won|lost|winless|return|miss|available|lineup|captain|milestone/i;
  const ranked=[...news].sort((a,b)=>Number(priority.test(b.title))-Number(priority.test(a.title)));
  const out=[], fingerprints=new Set();
  for(const item of ranked){
    if(!usefulTitle(item.title)) continue;
    const fact=humanFact(item);
    if(!fact) continue;
    const fp=fact.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,70);
    if(fingerprints.has(fp)) continue;
    fingerprints.add(fp); out.push(fact);
    if(out.length===3) break;
  }
  return out;
}

async function main(){
  const [fixtures,teams,old] = await Promise.all([
    getJson(`${DB}/${ROOT}/fixtures.json`),
    getJson(`${DB}/${ROOT}/teams.json`),
    getJson(`${DB}/${ROOT}/weeklySpotlight.json`).catch(()=>({}))
  ]);
  const now=Date.now();
  const all=Object.values(fixtures||{}).filter(m=>m&&m.mw>=1&&m.mw<=8&&m.k);
  const future=all.filter(m=>m.k*1000>now).sort((a,b)=>a.k-b.k);
  if(!future.length){ console.log("[spotlight] no future league-phase matchday"); return; }
  const md=Number(future[0].mw);
  const week=all.filter(m=>Number(m.mw)===md).sort((a,b)=>a.k-b.k);
  const first=week[0].k*1000;
  const hours=(first-now)/3600000;
  if(!FORCE && (hours<18 || hours>30)){
    console.log(`[spotlight] MD${md} starts in ${hours.toFixed(1)}h; outside 18–30h update window`); return;
  }
  if(!FORCE && Number(old?.matchday)===md && Number(old?.version)>=SPOTLIGHT_VERSION){
    console.log(`[spotlight] MD${md} v${SPOTLIGHT_VERSION} already published`); return;
  }

  console.log(`[spotlight] building MD${md} from ${week.length} matches`);
  const candidates=[];
  for(const m of week){
    const home=teamName(teams,m.h), away=teamName(teams,m.a);
    const [news,hv,av]=await Promise.all([newsFor(home,away),pageviews(home),pageviews(away)]);
    const views=hv+av;
    const facts=selectFacts(news);
    candidates.push({
      mid:m.id,home,away,k:m.k,
      score:scoreMatch(news.length,views),
      facts:facts.length?facts:[`${home} and ${away} meet in this week's Champions League league phase.`]
    });
  }
  candidates.sort((a,b)=>b.score-a.score);
  const items=candidates.slice(0,3).map(({score,...x})=>x);
  const payload={version:SPOTLIGHT_VERSION,matchday:md,generatedAt:Date.now(),firstKickoff:first,items};
  const r=await fetch(`${DB}/${ROOT}/weeklySpotlight.json`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!r.ok) throw new Error(`Firebase write failed ${r.status}: ${(await r.text()).slice(0,300)}`);
  console.log(`[spotlight] published MD${md}: ${items.map(x=>x.home+" v "+x.away).join(" · ")}`);
}

main().catch(e=>{console.error("[spotlight]",e?.message||e);process.exit(1);});