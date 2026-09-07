/* Weekly home-page spotlight generator.
   Runs once for each league-phase matchday, about one day before the first
   kickoff. It ranks the week's matches using recent Google News volume plus
   recent English-Wikipedia pageviews as a transparent interest proxy, then
   publishes the top three cards to Firebase. No extra API key is required. */

const ROOT = "cl2627";
const DB = (process.env.FIREBASE_DB_URL || "").trim().replace(/\/$/,"");
const FORCE = ["1","true"].includes(String(process.env.FORCE_SPOTLIGHT||"").toLowerCase());
const USER_AGENT = "ChampionsLeaguePredictor/1.0 (weekly home-page spotlight)";

if(!DB.startsWith("https://")) throw new Error("FIREBASE_DB_URL is missing");

async function getText(url){
  const r = await fetch(url,{headers:{"User-Agent":USER_AGENT,"Accept":"application/json,text/xml,application/rss+xml,text/plain,*/*"}});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.text();
}
async function getJson(url){ return JSON.parse(await getText(url)); }

const norm = s => String(s||"").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/<[^>]+>/g,"").trim();
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
    title:norm((b.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]),
    link:norm((b.match(/<link>([\s\S]*?)<\/link>/i)||[])[1]),
    source:norm((b.match(/<source[^>]*>([\s\S]*?)<\/source>/i)||[])[1]),
    date:norm((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)||[])[1])
  })).filter(x=>x.title);
}

async function newsFor(home,away){
  try{
    const q=encodeURIComponent(`"${home}" "${away}" Champions League when:7d`);
    const xml=await getText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
    return rssItems(xml).slice(0,30);
  }catch(e){ return []; }
}

function scoreMatch(newsCount,views){
  return newsCount*8 + Math.log10(Math.max(10,views))*12;
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
  if(!FORCE && Number(old?.matchday)===md){ console.log(`[spotlight] MD${md} already published`); return; }

  console.log(`[spotlight] building MD${md} from ${week.length} matches`);
  const candidates=[];
  for(const m of week){
    const home=teamName(teams,m.h), away=teamName(teams,m.a);
    const [news,hv,av]=await Promise.all([newsFor(home,away),pageviews(home),pageviews(away)]);
    const views=hv+av;
    const lead=news[0]||null;
    candidates.push({
      mid:m.id,home,away,k:m.k,newsCount:news.length,pageviews:views,
      score:scoreMatch(news.length,views),
      headline:lead?.title||"A European night worth watching",
      source:lead?.source||"Champions League spotlight",
      url:lead?.link||"",
      why:news.length
        ? `${news.length} recent news stories and ${views.toLocaleString("en-US")} combined Wikipedia views this week.`
        : `${views.toLocaleString("en-US")} combined Wikipedia views this week make this one of the matchday's higher-interest pairings.`
    });
  }
  candidates.sort((a,b)=>b.score-a.score);
  const items=candidates.slice(0,3).map(({score,...x})=>x);
  const payload={matchday:md,generatedAt:Date.now(),firstKickoff:first,method:"Recent Google News volume + 7-day English Wikipedia pageviews",items};
  const r=await fetch(`${DB}/${ROOT}/weeklySpotlight.json`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!r.ok) throw new Error(`Firebase write failed ${r.status}: ${(await r.text()).slice(0,300)}`);
  console.log(`[spotlight] published MD${md}: ${items.map(x=>x.home+" v "+x.away).join(" · ")}`);
}

main().catch(e=>{console.error("[spotlight]",e?.message||e);process.exit(1);});