/* Weekly Champions League Spotlight v7.

   Selection is intentionally NOT based on raw headline count. Raw search volume
   over-favored smaller fixtures with lots of syndicated preview pages.

   Match importance now combines:
   1) club stature / European pedigree / global fan relevance (dominant weight),
   2) balanced current fan interest (Wikipedia pageviews for BOTH clubs),
   3) credible matchup-specific news volume,
   4) a small bonus for established head-to-head history.

   This favors genuine headline fixtures involving two major clubs instead of a
   giant club vs a minnow or a small match with many duplicate preview stories.

   Each selected card then contains, when available:
   - verified UEFA head-to-head history,
   - one important injury / availability note,
   - one useful current / viral matchup story.
*/

const ROOT = "cl2627";
const DB = (process.env.FIREBASE_DB_URL || "").trim().replace(/\/$/, "");
const FORCE = ["1","true"].includes(String(process.env.FORCE_SPOTLIGHT || "").toLowerCase());
const USER_AGENT = "ChampionsLeaguePredictor/7.0 (weekly spotlight)";
const SPOTLIGHT_VERSION = 7;

if (!DB.startsWith("https://")) throw new Error("FIREBASE_DB_URL is missing");

/* 0–100 product relevance prior. It deliberately reflects both European
   pedigree and broad global interest, not just one-season form. The weaker
   club in a pairing gets more weight so balanced heavyweight games rise above
   glamour mismatches. */
const CLUB_STATURE = {
  "Real Madrid":100,"Barcelona":99,"Bayern München":96,"Man City":95,"Liverpool":95,"Paris":94,"Man Utd":93,"Arsenal":92,
  "Inter":90,"Atleti":85,"Dortmund":83,"Napoli":82,"Roma":80,"Porto":77,"Fenerbahçe":74,"Galatasaray":73,
  "Aston Villa":72,"Leipzig":71,"Feyenoord":70,"PSV":70,"Villarreal":70,"Sporting CP":69,"Real Betis":66,
  "Lille":65,"Shakhtar":65,"Club Brugge":64,"Stuttgart":64,"Slavia Praha":61,"Lens":60,"Como":59,"AEK Athens":58,
  "Bodø/Glimt":56,"LASK":54,"Slovan":51,"Viking":49,"Sabah":46
};

const VERIFIED_UEFA_H2H = {
  "Inter|Real Madrid": {meetings:19,aWins:10,bWins:7,draws:2,text:"Real Madrid and Inter have met 19 times in UEFA competition: Real Madrid won 10, Inter 7, with 2 draws."},
  "Arsenal|Napoli": {meetings:4,aWins:3,bWins:1,draws:0,text:"Napoli and Arsenal have met 4 times in UEFA competition: Arsenal won 3 and Napoli won 1."},
  "Barcelona|Feyenoord": {meetings:2,aWins:1,bWins:0,draws:1,text:"Barcelona and Feyenoord have played 2 previous UEFA matches: Barcelona won 1 and the other was a draw."},
  "Man City|Porto": {meetings:4,aWins:3,bWins:0,draws:1,text:"Porto and Man City have met 4 times in UEFA competition: Man City won 3 and the other was a draw."},
  "Atleti|Liverpool": {meetings:9,aWins:4,bWins:3,draws:2,text:"Liverpool and Atleti have met 9 times in UEFA competition: Liverpool won 4, Atleti 3, with 2 draws."}
};

async function getText(url, headers={}) {
  const r = await fetch(url,{redirect:"follow",headers:{"User-Agent":USER_AGENT,"Accept":"application/json,text/html,text/xml,application/rss+xml,text/plain,*/*",...headers}});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.text();
}
async function getJson(url){ return JSON.parse(await getText(url)); }

const cleanHtml = s => String(s||"")
  .replace(/<!\[CDATA\[|\]\]>/g,"").replace(/&amp;/g,"&").replace(/&#39;|&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g," ")
  .replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
const norm = s => String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
const teamName = (teams,c) => (teams[c] && (teams[c][0] || teams[c][1])) || c;
const pairKey = (a,b) => [a,b].sort((x,y)=>x.localeCompare(y)).join("|");
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));

const TEAM_ALIASES={
  "Real Madrid":["real madrid","madrid"],"Inter":["inter","inter milan","internazionale"],"Barcelona":["barcelona","barca"],
  "Feyenoord":["feyenoord"],"Napoli":["napoli"],"Arsenal":["arsenal"],"Liverpool":["liverpool"],
  "Atleti":["atleti","atletico madrid","atletico"],"Paris":["paris","psg","paris saint germain"],
  "Dortmund":["dortmund","borussia dortmund"],"Bayern München":["bayern","bayern munich","bayern munchen"],
  "Man City":["man city","manchester city"],"Man Utd":["man utd","manchester united"],"Roma":["roma"],
  "Club Brugge":["club brugge"],"Aston Villa":["aston villa"],"Porto":["porto"],"Lille":["lille"],"Real Betis":["real betis","betis"],
  "Sporting CP":["sporting cp","sporting"],"Galatasaray":["galatasaray"],"PSV":["psv","psv eindhoven"],
  "Shakhtar":["shakhtar","shakhtar donetsk"],"Leipzig":["leipzig","rb leipzig"],"Fenerbahçe":["fenerbahce","fenerbahçe"],
  "Slavia Praha":["slavia praha","slavia prague"],"Lens":["lens"],"Bodø/Glimt":["bodo glimt","bodø glimt"],
  "Villarreal":["villarreal"],"Stuttgart":["stuttgart"],"Viking":["viking"],"Slovan":["slovan","slovan bratislava"],
  "Como":["como"],"Sabah":["sabah"],"AEK Athens":["aek","aek athens"],"LASK":["lask"]
};
function aliases(name){ return (TEAM_ALIASES[name]||[name]).map(norm); }
function titleMentions(title,name){ const t=norm(title); return aliases(name).some(a=>a&&t.includes(a)); }

function isoDate(d){ return d.toISOString().slice(0,10).replaceAll("-",""); }
function wikiTitle(name){
  const map={
    "Man City":"Manchester_City_F.C.","Man Utd":"Manchester_United_F.C.","Paris":"Paris_Saint-Germain_F.C.","Atleti":"Atlético_Madrid",
    "Inter":"Inter_Milan","Dortmund":"Borussia_Dortmund","Bayern München":"FC_Bayern_Munich","Sporting CP":"Sporting_CP",
    "PSV":"PSV_Eindhoven","Slovan":"ŠK_Slovan_Bratislava","Shakhtar":"FC_Shakhtar_Donetsk","Bodø/Glimt":"FK_Bodø/Glimt",
    "Slavia Praha":"SK_Slavia_Prague","AEK Athens":"AEK_Athens_F.C.","Sabah":"Sabah_FC_(Azerbaijan)","Viking":"Viking_FK",
    "Leipzig":"RB_Leipzig","Club Brugge":"Club_Brugge_KV","Aston Villa":"Aston_Villa_F.C.","Real Betis":"Real_Betis",
    "Fenerbahçe":"Fenerbahçe_S.K._(football)","Galatasaray":"Galatasaray_S.K._(football)","Como":"Como_1907","Lens":"RC_Lens",
    "Lille":"Lille_OSC","Porto":"FC_Porto","Barcelona":"FC_Barcelona","Real Madrid":"Real_Madrid_CF","Liverpool":"Liverpool_F.C.",
    "Arsenal":"Arsenal_F.C.","Napoli":"SSC_Napoli","Roma":"AS_Roma","Villarreal":"Villarreal_CF","Stuttgart":"VfB_Stuttgart"
  };
  return map[name] || name.replaceAll(" ","_");
}
async function pageviews(name){
  try{
    const end=new Date(); end.setUTCDate(end.getUTCDate()-1);
    const start=new Date(end); start.setUTCDate(start.getUTCDate()-6);
    const j=await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(wikiTitle(name))}/daily/${isoDate(start)}/${isoDate(end)}`);
    return (j.items||[]).reduce((s,x)=>s+(Number(x.views)||0),0);
  }catch{return 0;}
}

function rssItems(xml){
  const blocks=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(x=>x[1]);
  return blocks.map(b=>({
    title:cleanHtml((b.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]),
    link:cleanHtml((b.match(/<link>([\s\S]*?)<\/link>/i)||[])[1]),
    source:cleanHtml((b.match(/<source[^>]*>([\s\S]*?)<\/source>/i)||[])[1])
  })).filter(x=>x.title);
}
async function newsQuery(q){
  try{return rssItems(await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`)).slice(0,40);}
  catch{return [];}
}
function sourceRank(source){
  const s=norm(source);
  if(/uefa|reuters|associated press|ap news|bbc|sky sports|espn|the athletic/.test(s)) return 4;
  if(/guardian|independent|cbs sports|nbc sports|goal|marca/.test(s)) return 3;
  if(/real madrid|arsenal|inter|barcelona|feyenoord|napoli|liverpool|atletico|manchester city|porto|bayern|paris saint germain/.test(s)) return 3;
  return 1;
}
async function newsFor(home,away){
  const base=`"${home}" "${away}" Champions League`;
  const [direct,injuries,stories]=await Promise.all([
    newsQuery(`${base} when:10d`),
    newsQuery(`${base} injury OR injured OR doubt OR suspended OR unavailable OR fitness OR ruled out when:10d`),
    newsQuery(`${base} manager OR coach OR record OR history OR bench OR rumour OR rumor OR controversy OR milestone when:10d`)
  ]);
  const seen=new Set(),out=[];
  for(const x of [...injuries,...stories,...direct]){
    const k=norm(x.title); if(seen.has(k)) continue; seen.add(k);
    out.push({...x,sourceRank:sourceRank(x.source)});
  }
  return out;
}

function matchupPrestige(home,away){
  const a=CLUB_STATURE[home]||55,b=CLUB_STATURE[away]||55;
  const lo=Math.min(a,b),hi=Math.max(a,b);
  return clamp(.70*lo+.30*hi+(lo>=80?5:0),0,100);
}
function fanInterest(hv,av){
  /* Geometric mean prevents one enormous fanbase from carrying a mismatch. */
  const balanced=Math.sqrt(Math.max(1,hv)*Math.max(1,av));
  return clamp((Math.log10(balanced)-3)*33.333,0,100);
}
function newsInterest(news,home,away){
  const relevant=news.filter(x=>titleMentions(x.title,home)&&titleMentions(x.title,away));
  const credible=relevant.filter(x=>x.sourceRank>=3).length;
  return clamp(credible*14+relevant.length*3,0,100);
}
function historyBonus(home,away){
  const n=VERIFIED_UEFA_H2H[pairKey(home,away)]?.meetings||0;
  return Math.min(4,Math.log2(n+1));
}
function importanceScore(home,away,hv,av,news){
  const prestige=matchupPrestige(home,away);
  const fans=fanInterest(hv,av);
  const current=newsInterest(news,home,away);
  return prestige*.82 + fans*.10 + current*.08 + historyBonus(home,away);
}

function humanFact(item){
  if(!item?.title) return "";
  let s=cleanHtml(item.title);
  if(item.source){const src=item.source.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");s=s.replace(new RegExp(`\\s*[-–—|:]\\s*${src}\\s*$`,"i"),"");}
  s=s.replace(/^UEFA Champions League\s*[:\-–—]\s*/i,"").replace(/^Champions League\s*[:\-–—]\s*/i,"").replace(/\s+/g," ").trim();
  if(/\b(rumou?r|reportedly|reports? say|linked with|could|may|might)\b/i.test(s)&&!/^Reports?:/i.test(s)) s=`Reports: ${s.charAt(0).toLowerCase()+s.slice(1)}`;
  if(s.length>132)s=s.slice(0,129).replace(/\s+\S*$/,"").trim()+"…";
  if(s&&!/[.!?…]$/.test(s))s+=".";
  return s;
}
function usefulTitle(title){return !/how to watch|live stream|tv channel|kick.?off time|tickets|odds|betting|prediction|predicted line.?up|predicted xi|where to watch/i.test(String(title||""));}
function eligible(item,home,away){return item&&item.sourceRank>=2&&usefulTitle(item.title)&&titleMentions(item.title,home)&&titleMentions(item.title,away);}
function categorizedFact(news,home,away,kind,used){
  const injury=/injur|ruled out|suspend|unavailable|fitness|doubt|miss(es|ing)?\b|return from injury/i;
  const viral=/manager|coach|record|history|unbeaten|winless|bench|rumou?r|report|controvers|milestone|captain|selection|starting|pressure/i;
  const test=kind==="injury"?injury:viral;
  for(const item of [...news].sort((a,b)=>b.sourceRank-a.sourceRank)){
    if(!eligible(item,home,away)||!test.test(item.title))continue;
    const fact=humanFact(item);if(!fact)continue;
    const fp=norm(fact).slice(0,80);if(used.has(fp))continue;
    used.add(fp);return fact;
  }
  return "";
}

function knownHistory(home,away){
  const h=VERIFIED_UEFA_H2H[pairKey(home,away)];
  if(!h)return "";
  if(h.aWins+h.bWins+h.draws!==h.meetings)throw new Error(`Invalid H2H for ${home} v ${away}`);
  return h.text;
}
async function discoverUefaHistory(home,away){
  const known=knownHistory(home,away);if(known)return known;
  try{
    const hits=await newsQuery(`site:uefa.com/uefachampionsleague/news "${home}" "${away}" facts`);
    const uefa=hits.find(x=>/uefa/i.test(x.source||"")&&x.link);if(!uefa)return "";
    const text=cleanHtml(await getText(uefa.link));
    const start=text.search(/Previous meetings/i);if(start<0)return "";
    let section=text.slice(start+17,start+1600);
    const stop=section.search(/\b(?:Form guide|Team news|Key stats|Latest news|Meet the teams|Domestic form)\b/i);if(stop>80)section=section.slice(0,stop);
    const sentences=(section.match(/[^.!?]+[.!?]/g)||[]).map(s=>s.trim()).filter(s=>s.length>25&&/\b(?:met|meeting|fixtures?|matches?|won|draw|lost|triumph)\b/i.test(s));
    if(!sentences.length)return "";
    let fact=sentences.slice(0,2).join(" ").replace(/\s+/g," ").trim();
    if(fact.length>230)fact=fact.slice(0,227).replace(/\s+\S*$/,"")+"…";
    return fact;
  }catch{return "";}
}

async function main(){
  const [fixtures,teams,old]=await Promise.all([
    getJson(`${DB}/${ROOT}/fixtures.json`),getJson(`${DB}/${ROOT}/teams.json`),getJson(`${DB}/${ROOT}/weeklySpotlight.json`).catch(()=>({}))
  ]);
  const now=Date.now();
  const all=Object.values(fixtures||{}).filter(m=>m&&m.mw>=1&&m.mw<=8&&m.k);
  const future=all.filter(m=>m.k*1000>now).sort((a,b)=>a.k-b.k);
  if(!future.length){console.log("[spotlight] no future league-phase matchday");return;}
  const md=Number(future[0].mw),week=all.filter(m=>Number(m.mw)===md).sort((a,b)=>a.k-b.k),first=week[0].k*1000;
  const hours=(first-now)/3600000,oldVersion=Number(old?.version)||0;
  const versionUpgrade=Number(old?.matchday)===md&&oldVersion<SPOTLIGHT_VERSION;
  if(!FORCE&&!versionUpgrade&&(hours<24||hours>48)){console.log(`[spotlight] MD${md} starts in ${hours.toFixed(1)}h; outside 24–48h window`);return;}
  if(!FORCE&&Number(old?.matchday)===md&&oldVersion>=SPOTLIGHT_VERSION){console.log(`[spotlight] MD${md} v${SPOTLIGHT_VERSION} already published`);return;}

  const candidates=[];
  for(const m of week){
    const home=teamName(teams,m.h),away=teamName(teams,m.a);
    const [news,hv,av]=await Promise.all([newsFor(home,away),pageviews(home),pageviews(away)]);
    const score=importanceScore(home,away,hv,av,news);
    candidates.push({m,home,away,news,hv,av,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  console.log("[spotlight] ranking:");
  candidates.forEach((x,i)=>console.log(`[spotlight] ${i+1}. ${x.home} v ${x.away} = ${x.score.toFixed(1)} (prestige ${matchupPrestige(x.home,x.away).toFixed(1)}, fans ${fanInterest(x.hv,x.av).toFixed(1)}, news ${newsInterest(x.news,x.home,x.away).toFixed(1)})`));

  const chosen=candidates.slice(0,3),items=[];
  for(const x of chosen){
    const used=new Set();
    const history=await discoverUefaHistory(x.home,x.away);if(history)used.add(norm(history).slice(0,80));
    const injury=categorizedFact(x.news,x.home,x.away,"injury",used);
    const viral=categorizedFact(x.news,x.home,x.away,"viral",used);
    items.push({mid:x.m.id,home:x.home,away:x.away,k:x.m.k,facts:[history,injury,viral].filter(Boolean)});
  }

  const payload={version:SPOTLIGHT_VERSION,matchday:md,generatedAt:Date.now(),firstKickoff:first,selectionMethod:"82% matchup stature + 10% balanced fan interest + 8% credible matchup news, with small H2H bonus",items};
  const r=await fetch(`${DB}/${ROOT}/weeklySpotlight.json`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!r.ok)throw new Error(`Firebase write failed ${r.status}: ${(await r.text()).slice(0,300)}`);
  console.log(`[spotlight] published v${SPOTLIGHT_VERSION} MD${md}: ${items.map(x=>x.home+" v "+x.away).join(" · ")}`);
}
main().catch(e=>{console.error("[spotlight] ERROR",e?.message||e);process.exit(1);});