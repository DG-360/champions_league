#!/usr/bin/env python3
"""Champions League Betable hybrid model v2.

Core ML uses historical UCL matches and, for form features, only the previous
five UCL matches from the same phase family (league/group vs knockout).
A bounded weekly live layer then adds:
- last five finished matches in any competition from football-data.org,
- user predictions weighted by predicted winning margin,
- online injury/availability research,
- online tactical-preview research.

The heavy API/news work runs only when the matchweek is due (roughly one day
before the first kickoff) or when the model version changes.
"""
from __future__ import annotations
import argparse, csv, io, json, math, os, re, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT="cl2627"; MODEL_VERSION=2; MODEL_NAME="UCL-Hybrid-v2"
HIST_YEARS=list(range(2018,2026))
SOURCE="https://fixturedownload.com/download/champions-league-{year}-UTC.csv"

# Explicit weekly-live coefficients. They are logit/probability weights, not
# direct percentage-point additions.
RECENT_FORM_LOGIT=.22
RECENT_GD_LOGIT=.08
INJURY_LOGIT_PER_LEVEL=.09
TACTICAL_LOGIT_PER_LEVEL=.06
MAX_CONTEXT_SHIFT=.35
CROWD_MAX_BLEND=.15
CROWD_MARGIN_STEP=.20
RUN_WINDOW_MIN_H=20
RUN_WINDOW_MAX_H=44

ALIASES={
 "manchester city":"man city","manchester united":"man united","man utd":"man united",
 "paris saint germain":"paris","paris saint-germain":"paris","psg":"paris",
 "internazionale":"inter","inter milan":"inter","bayern munich":"bayern munchen","bayern münchen":"bayern munchen",
 "borussia dortmund":"b dortmund","dortmund":"b dortmund","atletico madrid":"atleti","atlético madrid":"atleti",
 "red bull leipzig":"leipzig","rb leipzig":"leipzig","bayer leverkusen":"leverkusen",
 "sporting lisbon":"sporting cp","shakhtar donetsk":"shakhtar","club brugge kv":"club brugge",
 "fc barcelona":"barcelona","real madrid cf":"real madrid"
}
TEAM_ALIASES={
 "real madrid":["real madrid","madrid"],"inter":["inter","inter milan","internazionale"],"barcelona":["barcelona","barca"],
 "feyenoord":["feyenoord"],"napoli":["napoli"],"arsenal":["arsenal"],"liverpool":["liverpool"],
 "atleti":["atleti","atletico madrid","atletico"],"paris":["paris","psg","paris saint germain"],
 "b dortmund":["dortmund","borussia dortmund"],"bayern munchen":["bayern","bayern munich","bayern munchen"],
 "man city":["man city","manchester city"],"man united":["man utd","manchester united"],"roma":["roma"],
 "club brugge":["club brugge"],"aston villa":["aston villa"],"porto":["porto"],"lille":["lille"],
 "real betis":["real betis","betis"],"sporting cp":["sporting cp","sporting"],"galatasaray":["galatasaray"],
 "psv":["psv","psv eindhoven"],"shakhtar":["shakhtar","shakhtar donetsk"],"leipzig":["leipzig","rb leipzig"],
 "fenerbahce":["fenerbahce","fenerbahçe"],"slavia praha":["slavia praha","slavia prague"],"lens":["lens"],
 "bodo glimt":["bodo glimt","bodø glimt"],"villarreal":["villarreal"],"stuttgart":["stuttgart"],
 "viking":["viking"],"slovan":["slovan","slovan bratislava"],"como":["como"],"sabah":["sabah"],
 "aek athens":["aek","aek athens"],"lask":["lask"]
}
TRUSTED_RE=re.compile(r"uefa|reuters|associated press|ap news|bbc|sky sports|espn|the athletic|guardian|independent|cbs sports|nbc sports|goal|marca|official",re.I)

def canon(s):
 s=str(s or "").lower().strip().replace("&"," and ")
 for a,b in [("ü","u"),("é","e"),("á","a"),("í","i"),("ó","o"),("ç","c"),("ø","o")]: s=s.replace(a,b)
 s=re.sub(r"\b(fc|cf|afc|calcio|football club)\b"," ",s); s=re.sub(r"[^a-z0-9 ]+"," ",s); s=re.sub(r"\s+"," ",s).strip()
 return ALIASES.get(s,s)

def fetch_text(url,timeout=30,headers=None):
 h={"User-Agent":"ucl-betable-model/2.0"}; h.update(headers or {})
 req=urllib.request.Request(url,headers=h)
 with urllib.request.urlopen(req,timeout=timeout) as r:return r.read().decode("utf-8-sig",errors="replace")

def http_json(url,method="GET",payload=None,headers=None):
 data=None if payload is None else json.dumps(payload).encode(); h={"Content-Type":"application/json","User-Agent":"ucl-betable-model/2.0"}; h.update(headers or {})
 req=urllib.request.Request(url,data=data,method=method,headers=h)
 with urllib.request.urlopen(req,timeout=35) as r:
  raw=r.read().decode(); return json.loads(raw) if raw else None

def parse_score(raw):
 n=re.findall(r"\d+",str(raw or "")); return (int(n[0]),int(n[1])) if len(n)>=2 else None

def parse_date(raw):
 for fmt in ("%d/%m/%Y %H:%M","%d/%m/%Y","%Y-%m-%d %H:%M:%S","%Y-%m-%d"):
  try:return datetime.strptime(str(raw or "").strip(),fmt)
  except ValueError:pass
 return None

def hist_phase(raw):return "league" if re.fullmatch(r"\d+",str(raw or "").strip()) else "knockout"
def fixture_phase(f):
 st=str(f.get("stage") or "").upper(); mw=int(f.get("mw",1) or 1)
 return "league" if mw<=8 or st in {"LEAGUE_STAGE","LEAGUE_PHASE","GROUP_STAGE","REGULAR_SEASON"} else "knockout"

def load_history(cache):
 cache.mkdir(parents=True,exist_ok=True); rows=[]
 for year in HIST_YEARS:
  fp=cache/f"ucl-{year}.csv"
  try:
   if not fp.exists() or fp.stat().st_size<200:fp.write_text(fetch_text(SOURCE.format(year=year)),encoding="utf-8")
   for r in csv.DictReader(io.StringIO(fp.read_text(encoding="utf-8-sig",errors="replace"))):
    h=r.get("Home Team") or r.get("HomeTeam") or r.get("Home"); a=r.get("Away Team") or r.get("AwayTeam") or r.get("Away")
    sc=parse_score(r.get("Result") or r.get("Score")); dt=parse_date(r.get("Date") or r.get("Date/Time")); rnd=r.get("Round Number") or r.get("Round") or ""
    if h and a and sc and dt:rows.append((dt,canon(h),canon(a),sc[0],sc[1],year,hist_phase(rnd)))
  except Exception as e:print(f"[ucl-model] history {year} skipped: {e}")
 rows.sort(key=lambda x:x[0])
 if len(rows)<300:raise RuntimeError(f"Only {len(rows)} usable historical UCL matches loaded")
 return rows

class State:
 def __init__(self):
  self.elo=defaultdict(lambda:1500.0)
  self.form=defaultdict(lambda:{"league":deque(maxlen=5),"knockout":deque(maxlen=5)})
  self.gd=defaultdict(lambda:{"league":deque(maxlen=5),"knockout":deque(maxlen=5)})
 def feat(self,h,a,phase):
  fh=np.mean(self.form[h][phase]) if self.form[h][phase] else .5; fa=np.mean(self.form[a][phase]) if self.form[a][phase] else .5
  gh=np.mean(self.gd[h][phase]) if self.gd[h][phase] else 0.; ga=np.mean(self.gd[a][phase]) if self.gd[a][phase] else 0.
  return [self.elo[h]-self.elo[a],fh-fa,gh-ga,1. if phase=="knockout" else 0.]
 def update(self,h,a,hg,ag,phase):
  exp=1/(1+10**(-((self.elo[h]+55)-self.elo[a])/400)); act=1. if hg>ag else 0. if hg<ag else .5; d=24*(act-exp)
  self.elo[h]+=d; self.elo[a]-=d; rh=1 if hg>ag else .5 if hg==ag else 0; ra=1-rh if hg!=ag else .5
  self.form[h][phase].append(rh); self.form[a][phase].append(ra); self.gd[h][phase].append(hg-ag); self.gd[a][phase].append(ag-hg)

def build_dataset(rows):
 st=State();X=[];y=[]
 for _,h,a,hg,ag,_,ph in rows:X.append(st.feat(h,a,ph));y.append("H" if hg>ag else "A" if hg<ag else "D");st.update(h,a,hg,ag,ph)
 return np.asarray(X,float),np.asarray(y),st

def current_round(fixtures,results):
 for mw in sorted({int(f.get("mw",1)) for f in fixtures}):
  week=[f for f in fixtures if int(f.get("mw",1))==mw]
  if week and any(f["id"] not in results for f in week):return mw
 return 1

def softmax(v):
 x=np.asarray(v,float);x-=x.max();e=np.exp(x);return e/e.sum()
def shift_probs(p,s):
 p=np.maximum(np.asarray(p,float),1e-9);return softmax([math.log(p[0])+s,math.log(p[1]),math.log(p[2])-s])

def team_api_id(t):
 if isinstance(t,list):
  if len(t)>8 and str(t[8]).isdigit():return int(t[8])
  if len(t)>7:
   m=re.search(r"/(\d+)\.(?:svg|png|jpg|jpeg)(?:\?|$)",str(t[7] or ""),re.I)
   if m:return int(m.group(1))
 return None

def recent_form(team_id,token):
 if not team_id or not token:return None
 try:j=http_json(f"https://api.football-data.org/v4/teams/{team_id}/matches?status=FINISHED&limit=5",headers={"X-Auth-Token":token,"Accept":"application/json"})
 except Exception as e:print(f"[ucl-model] recent form unavailable for {team_id}: {e}");return None
 arr=[]
 for m in sorted(j.get("matches") or [],key=lambda x:str(x.get("utcDate") or ""),reverse=True)[:5]:
  ft=((m.get("score") or {}).get("fullTime") or {}); hid=(m.get("homeTeam") or {}).get("id"); aid=(m.get("awayTeam") or {}).get("id")
  if ft.get("home") is None or ft.get("away") is None:continue
  hg,ag=int(ft["home"]),int(ft["away"])
  if int(hid or -1)==team_id:gf,ga=hg,ag
  elif int(aid or -1)==team_id:gf,ga=ag,hg
  else:continue
  arr.append((1. if gf>ga else .5 if gf==ga else 0.,gf-ga))
 if not arr:return None
 return {"n":len(arr),"form":float(np.mean([x[0] for x in arr])),"gd":float(np.mean([x[1] for x in arr]))}

def rss(q):
 try:
  u="https://news.google.com/rss/search?q="+urllib.parse.quote(q)+"&hl=en-US&gl=US&ceid=US:en"; root=ET.fromstring(fetch_text(u,25));out=[]
  for it in root.findall(".//item"):
   title=" ".join((it.findtext("title") or "").split());source=" ".join((it.findtext("source") or "").split())
   if title:out.append({"title":title,"source":source})
  return out[:30]
 except Exception as e:print(f"[ucl-model] news search failed: {e}");return []

def mentions(title,team):
 t=canon(title);return any(canon(a) in t for a in TEAM_ALIASES.get(canon(team),[canon(team)]))
def source_rank(s):return 3 if TRUSTED_RE.search(str(s or "")) else 2 if re.search(r"football|soccer|sport",str(s or ""),re.I) else 1

def injury_level(team,opp):
 items=rss(f'"{team}" "{opp}" Champions League injury OR injured OR "ruled out" OR doubt OR suspended when:7d');lvl=0;note=""
 major=re.compile(r"ruled out|will miss|set to miss|suspend|major blow|key player|captain|star|first-choice|goalkeeper|striker",re.I);mid=re.compile(r"injur|fitness|doubt|knock|late test|questionable|unavailable",re.I)
 for x in items:
  if source_rank(x["source"])<2 or not mentions(x["title"],team):continue
  n=2 if major.search(x["title"]) else 1 if mid.search(x["title"]) else 0
  if n>lvl:lvl=n;note=x["title"]
 return {"level":lvl,"note":note}

def tactical_title_score(title,home,away):
 t=canon(title)
 if not (mentions(title,home) and mentions(title,away)):return 0
 pos=r"(?:edge|advantage|exploit|favour|favor|dominant|strength|upper hand|well suited)";neg=r"(?:weakness|vulnerab|struggle|problem|concern|exposed)";score=0
 for team,sign in ((home,1),(away,-1)):
  for alias in TEAM_ALIASES.get(canon(team),[canon(team)]):
   a=re.escape(canon(alias))
   if re.search(a+r".{0,45}"+pos,t) or re.search(pos+r".{0,45}"+a,t):score+=sign;break
   if re.search(a+r".{0,45}"+neg,t) or re.search(neg+r".{0,45}"+a,t):score-=sign;break
 return max(-1,min(1,score))

def tactical_edge(home,away):
 items=rss(f'"{home}" "{away}" Champions League tactical analysis preview weakness advantage pressing when:10d');total=0;ev=[]
 for x in items:
  if source_rank(x["source"])<2:continue
  s=tactical_title_score(x["title"],home,away)
  if s:total+=s;ev.append(x["title"])
  if len(ev)>=3:break
 return {"edge":max(-2,min(2,total)),"evidence":ev[:3]}

def crowd(mid,preds,players):
 votes=np.zeros(3,float);n=0
 for pid,p in ((preds or {}).get(mid) or {}).items():
  if pid not in players or not isinstance(p,dict):continue
  try:h,a=int(p.get("h")),int(p.get("a"))
  except Exception:continue
  n+=1
  if h>a:votes[0]+=1+CROWD_MARGIN_STEP*min(max(h-a-1,0),3)
  elif a>h:votes[2]+=1+CROWD_MARGIN_STEP*min(max(a-h-1,0),3)
  else:votes[1]+=1
 if not n or votes.sum()<=0:return None
 coverage=min(1.,n/max(1,len(players)));blend=CROWD_MAX_BLEND*coverage if n>=3 else 0.
 return {"p":votes/votes.sum(),"submitted":n,"totalPlayers":len(players),"coverage":coverage,"blend":blend}

def due(fixtures,results,meta,force=False):
 mw=current_round(fixtures,results);week=[f for f in fixtures if int(f.get("mw",1))==mw];openw=[f for f in week if f["id"] not in results]
 if not openw:return False,mw,0.,"no open fixtures"
 first=min(int(f.get("k",0)) for f in week if int(f.get("k",0))>0)*1000;hours=(first-int(datetime.now(timezone.utc).timestamp()*1000))/3600000
 oldv=int(meta.get("modelVersion",0) or 0);oldr=int(meta.get("currentRound",0) or 0);upgrade=oldr==mw and oldv<MODEL_VERSION
 if force or upgrade:return True,mw,hours,"forced/version upgrade"
 if oldr==mw and oldv>=MODEL_VERSION:return False,mw,hours,"already calculated"
 return (RUN_WINDOW_MIN_H<=hours<=RUN_WINDOW_MAX_H),mw,hours,"weekly window" if RUN_WINDOW_MIN_H<=hours<=RUN_WINDOW_MAX_H else "outside weekly window"

def main():
 ap=argparse.ArgumentParser();ap.add_argument("--repo-root",default=".");ap.add_argument("--publish",action="store_true");ap.add_argument("--force",action="store_true");args=ap.parse_args()
 db=os.environ.get("FIREBASE_DB_URL","").rstrip("/");token=os.environ.get("FOOTBALL_DATA_TOKEN","").strip()
 if not db:raise SystemExit("FIREBASE_DB_URL required")
 feed=http_json(f"{db}/{ROOT}.json") or {};fixtures=list((feed.get("fixtures") or {}).values());teams=feed.get("teams") or {};results=feed.get("results") or {};preds=feed.get("preds") or {};players=feed.get("players") or {};oldmeta=feed.get("modelMeta") or {}
 if not fixtures:return
 fixtures.sort(key=lambda f:(int(f.get("k",0)),int(f.get("mw",1))));ok,mw,hours,why=due(fixtures,results,oldmeta,args.force);print(f"[ucl-model] preflight MD{mw}: {hours:.1f}h · {why}")
 if not ok:return
 rows=load_history(Path(args.repo_root)/"model_cache");X,y,state=build_dataset(rows);model=Pipeline([("scale",StandardScaler()),("lr",LogisticRegression(max_iter=1500,C=.7))]);model.fit(X,y)
 def name(code):
  t=teams.get(code) or [];return canon(t[0] if isinstance(t,list) and t else code)
 for f in fixtures:
  r=results.get(f["id"])
  if r:state.update(name(f["h"]),name(f["a"]),int(r.get("h",0)),int(r.get("a",0)),fixture_phase(f))
 upcoming=[f for f in fixtures if int(f.get("mw",1))==mw and f["id"] not in results];codes=sorted({f["h"] for f in upcoming}|{f["a"] for f in upcoming});recent={}
 for i,c in enumerate(codes):
  recent[c]=recent_form(team_api_id(teams.get(c)),token)
  if i<len(codes)-1:time.sleep(6.2)
 out={};research={};classes=list(model.named_steps["lr"].classes_)
 for f in upcoming:
  hc,ac=f["h"],f["a"];h,a=name(hc),name(ac);raw=model.predict_proba([state.feat(h,a,fixture_phase(f))])[0];d={classes[i]:float(raw[i]) for i in range(len(classes))};base=np.array([d.get("H",0),d.get("D",0),d.get("A",0)])
  rh,ra=recent.get(hc),recent.get(ac);fd=gd=0.
  if rh and ra and rh["n"]>=3 and ra["n"]>=3:fd=float(rh["form"]-ra["form"]);gd=math.tanh((float(rh["gd"])-float(ra["gd"]))/2)
  hi=injury_level(h,a);ai=injury_level(a,h);ta=tactical_edge(h,a);sr=RECENT_FORM_LOGIT*fd+RECENT_GD_LOGIT*gd;si=INJURY_LOGIT_PER_LEVEL*(ai["level"]-hi["level"]);st=TACTICAL_LOGIT_PER_LEVEL*ta["edge"];ctx=max(-MAX_CONTEXT_SHIFT,min(MAX_CONTEXT_SHIFT,sr+si+st));p=shift_probs(base,ctx)
  cr=crowd(f["id"],preds,players);blend=cr["blend"] if cr else 0.
  if cr and blend>0:p=(1-blend)*p+blend*cr["p"];p=p/p.sum()
  out[f["id"]]={"pH":float(p[0]),"pD":float(p[1]),"pA":float(p[2]),"baseH":float(base[0]),"baseD":float(base[1]),"baseA":float(base[2]),"model":MODEL_NAME,"at":int(datetime.now(timezone.utc).timestamp()*1000)}
  research[f["id"]]={"recentAllCompetitions":{"home":rh,"away":ra,"formDiff":fd,"gdScaledDiff":gd,"logitShift":sr},"injuries":{"home":hi,"away":ai,"logitShift":si},"tactical":{"edge":ta["edge"],"evidence":ta["evidence"],"logitShift":st},"crowd":None if not cr else {"pH":float(cr["p"][0]),"pD":float(cr["p"][1]),"pA":float(cr["p"][2]),"submitted":cr["submitted"],"totalPlayers":cr["totalPlayers"],"blend":blend},"contextShift":ctx}
 lr=model.named_steps["lr"];sc=model.named_steps["scale"]
 meta={"selectedModel":MODEL_NAME,"modelVersion":MODEL_VERSION,"historyMatches":len(rows),"historySeasons":f"{HIST_YEARS[0]}/{str(HIST_YEARS[0]+1)[-2:]}–{HIST_YEARS[-1]}/{str(HIST_YEARS[-1]+1)[-2:]}","currentRound":mw,"features":["UCL Elo difference","previous 5 same-phase UCL result-form difference","previous 5 same-phase UCL goal-difference difference","phase indicator","previous 5 matches in all competitions","user score predictions weighted by predicted winning margin","online injury/availability research","online tactical-preview research"],"coefficients":{"recentAllCompetitionFormLogit":RECENT_FORM_LOGIT,"recentAllCompetitionGoalDiffLogit":RECENT_GD_LOGIT,"injuryLogitPerLevel":INJURY_LOGIT_PER_LEVEL,"tacticalLogitPerLevel":TACTICAL_LOGIT_PER_LEVEL,"maxContextShift":MAX_CONTEXT_SHIFT,"crowdMaxBlend":CROWD_MAX_BLEND,"crowdMarginWeightStep":CROWD_MARGIN_STEP},"trained":{"classes":list(map(str,lr.classes_)),"coef":lr.coef_.tolist(),"intercept":lr.intercept_.tolist(),"scalerMean":sc.mean_.tolist(),"scalerScale":sc.scale_.tolist()},"m3":{"liveAdjustment":{"injury_logit_per_level":0,"tactical_logit_per_level":0,"uncertainty_temperature":0,"max_abs_logit_shift":0}},"bettable":{"min_prob":.58,"min_margin":.08},"weeklyCalculation":{"windowHoursBeforeFirstKickoff":[RUN_WINDOW_MIN_H,RUN_WINDOW_MAX_H],"webResearchCached":True},"updated":int(datetime.now(timezone.utc).timestamp()*1000)}
 payload={"modelPredictions":out,"modelMeta":meta,"modelResearch":research}
 if args.publish:http_json(f"{db}/{ROOT}.json",method="PATCH",payload=payload);print(f"[ucl-model] published {len(out)} hybrid predictions for MD{mw}")
 else:print(json.dumps(payload,indent=2))

if __name__=="__main__":main()
