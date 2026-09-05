/* UCL EXPERIENCE LAYER · visual/UX only. Core scoring, auth and Firebase rules remain unchanged. */
(() => {
  "use strict";

  const CORE_PAINT = paint;

  function uclPhaseIndex(){
    const mw = typeof liveMW === "function" ? liveMW() : 1;
    if (mw <= 8) return 0;
    if (mw === 9) return 1;
    if (mw === 10) return 2;
    if (mw === 11) return 3;
    if (mw === 12) return 4;
    return 5;
  }

  function uclPhaseKey(i){
    return ["league","playoffs","r16","quarter","semi","final"][Math.max(0,Math.min(5,i))];
  }

  function uclPhaseName(i){
    return ["League Phase","Knockout Play-offs","Round of 16","Quarter-finals","Semi-finals","Final"][Math.max(0,Math.min(5,i))];
  }

  function uclSetPhaseTheme(){
    document.body.dataset.uclPhase = uclPhaseKey(uclPhaseIndex());
  }

  function uclRoad(){
    const names = [
      ["LP","League Phase"],
      ["PO","Play-offs"],
      ["R16","Round of 16"],
      ["QF","Quarter-finals"],
      ["SF","Semi-finals"],
      ["F","Final"]
    ];
    const active = uclPhaseIndex();
    return '<section class="ucl-card ucl-road">'
      + '<div class="ucl-road-top"><div><small>Competition journey</small><h2>Road to the Final</h2></div>'
      + '<small>' + esc(uclPhaseName(active)) + '</small></div>'
      + '<div class="ucl-road-track">'
      + names.map((x,i) => '<div class="ucl-stage' + (i<active?' done':'') + (i===active?' active':'') + (i===5?' final':'') + '">'
        + '<span class="ucl-stage-dot">' + x[0] + '</span><span class="ucl-stage-name">' + x[1] + '</span></div>').join("")
      + '</div></section>';
  }

  function uclRankInfo(){
    const t = tallies(), rk = rankedPids(), mine = t[me] || {pts:0,x3:0,played:0};
    const pos = Math.max(1,rk.indexOf(me)+1);
    return {pts:mine.pts||0, exact:mine.x3||0, played:mine.played||0, rank:pos, players:rk.length||1};
  }

  function uclPredictionProgress(){
    const open = ALL.filter(m => !results[m.id] && !locked(m));
    const predicted = open.filter(m => full(predOf(m.id,me))).length;
    return {predicted,total:open.length};
  }

  function uclNextMatches(limit){
    return ALL.filter(m => !results[m.id] && koOf(m) > now())
      .sort((a,b)=>koOf(a)-koOf(b)).slice(0,limit||3);
  }

  function uclMiniFixture(m){
    const dt = new Date(koOf(m));
    return '<div class="ucl-next-row">'
      + '<div class="ucl-next-team">' + crest(m.h,true) + '<span>' + esc(teamFull(m.h)) + '</span></div>'
      + '<div class="ucl-next-mid">' + esc(roundName(m.mw)) + '<b>' + dt.toLocaleDateString([], {day:"numeric",month:"short"}) + ' · ' + fmtTime(koOf(m)) + '</b></div>'
      + '<div class="ucl-next-team a"><span>' + esc(teamFull(m.a)) + '</span>' + crest(m.a,true) + '</div>'
      + '</div>';
  }

  function uclHero(){
    const idx = uclPhaseIndex();
    return '<section class="ucl-hero" aria-label="UEFA Champions League predictor">'
      + '<div class="ucl-hero-inner">'
      + '<div class="ucl-eyebrow"><span>UEFA Champions League</span></div>'
      + '<h1 class="ucl-hero-title">UEFA Champions League<strong>Prediction League</strong></h1>'
      + '<div class="ucl-hero-sub"><span class="ucl-live-dot"></span><span>' + esc(uclPhaseName(idx)) + '</span><span class="ucl-season">2026/27</span></div>'
      + '</div></section>';
  }

  function viewHomeUCL(){
    const st = uclRankInfo();
    const pr = uclPredictionProgress();
    const next = uclNextMatches(3);
    const nextPanel = '<section class="ucl-card">'
      + '<div class="ucl-card-h"><span>Next European nights</span><b>' + esc(uclPhaseName(uclPhaseIndex())) + '</b></div>'
      + '<div class="ucl-next">' + (next.length ? next.map(uclMiniFixture).join("") : '<div class="empty">No upcoming fixture is available yet.</div>') + '</div>'
      + '<div class="ucl-cta-row"><button class="ucl-cta primary" onclick="go(\'fx\')">Make predictions</button>'
      + '<button class="ucl-cta" onclick="go(\'competition\')">View competition</button></div></section>';
    const stats = '<section class="ucl-card">'
      + '<div class="ucl-card-h"><span>Your campaign</span><b>' + esc(players[me]?.name || "") + '</b></div>'
      + '<div class="ucl-stat-row">'
      + '<div class="ucl-stat"><strong>' + st.rank + '</strong><small>Rank of ' + st.players + '</small></div>'
      + '<div class="ucl-stat"><strong>' + st.pts + '</strong><small>Points</small></div>'
      + '<div class="ucl-stat"><strong>' + pr.predicted + '/' + pr.total + '</strong><small>Open picks set</small></div>'
      + '</div></section>';
    return uclHero() + '<div class="ucl-dashboard-grid">' + nextPanel + stats + '</div>' + uclRoad();
  }

  function uclFormCells(r){
    return r.form.slice(-5).map(f => {
      const style = f==="W"
        ? "background:rgba(44,155,255,.15);color:#74dfff"
        : f==="D"
          ? "background:rgba(255,255,255,.075);color:#aabada"
          : "background:rgba(91,71,139,.18);color:#a89bd0";
      return '<span style="display:inline-block;width:16px;height:16px;line-height:16px;border-radius:5px;font-size:8px;font-weight:700;margin-left:2px;' + style + '">' + f + '</span>';
    }).join("");
  }

  function uclLeagueTablePanel(){
    const rows = leagueTable();
    const phase = ALL.filter(isLeaguePhase);
    const played = phase.filter(m => results[m.id]).length;
    let body = "";
    rows.forEach((r,i) => {
      if(i===0) body += '<tr class="ucl-zone-head direct"><td colspan="9">1–8 · Direct qualification to the Round of 16</td></tr>';
      if(i===8) body += '<tr class="ucl-zone-head playoff"><td colspan="9">9–24 · Knockout play-off places</td></tr>';
      if(i===24) body += '<tr class="ucl-zone-head out"><td colspan="9">25–36 · Eliminated</td></tr>';
      const gd = r.gf-r.ga;
      const cls = i<8 ? "ucl-row-direct" : i<24 ? "ucl-row-playoff" : "ucl-row-out";
      body += '<tr class="' + cls + '"><td><div class="tm-cell"><span class="pos mono">' + (i+1) + '</span>'
        + crest(r.c,"lg") + '<span style="font-weight:650">' + esc(teamFull(r.c)) + '</span></div></td>'
        + '<td class="mono">' + r.p + '</td><td class="mono">' + r.w + '</td><td class="mono">' + r.d + '</td><td class="mono">' + r.l + '</td>'
        + '<td class="mono" style="color:var(--txt2)">' + r.gf + '-' + r.ga + '</td>'
        + '<td class="mono">' + (gd>0?"+":"") + gd + '</td><td class="mono" style="font-weight:800;color:#dbe9ff">' + r.pts + '</td>'
        + '<td style="text-align:right">' + uclFormCells(r) + '</td></tr>';
    });
    return '<section class="panel"><div class="panel-h"><h3>League Phase</h3><small>'
      + (phase.length ? played + ' of ' + phase.length + ' matches played' : 'waiting for fixtures') + '</small></div>'
      + '<div class="ucl-table-wrap"><table class="ucl-table"><thead><tr><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Goals</th><th>GD</th><th>Pts</th><th style="text-align:right">Form</th></tr></thead><tbody>'
      + body + '</tbody></table></div>'
      + '<div class="ucl-key"><span><b>1–8</b>Direct to Round of 16</span><span><b>9–24</b>Knockout play-offs</span><span><b>25–36</b>Eliminated</span></div></section>';
  }

  function uclRoundGroups(mw){
    const items = ALL.filter(m => Number(m.mw)===mw);
    const groups = new Map();
    items.forEach(m => {
      const key = [m.h,m.a].sort().join("|");
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(m);
    });
    return Array.from(groups.values()).sort((a,b)=>koOf(a[0])-koOf(b[0]));
  }

  function uclTie(group){
    if(!group || !group.length) return '<div class="ucl-tie empty">Awaiting qualified teams</div>';
    const a = group[0];
    const codes = [a.h,a.a];
    const totals = {[codes[0]]:0,[codes[1]]:0};
    let settled = 0;
    group.forEach(m => {
      const r = results[m.id];
      if(!r) return;
      settled++;
      totals[m.h] = (totals[m.h]||0) + Number(r.h||0);
      totals[m.a] = (totals[m.a]||0) + Number(r.a||0);
    });
    const score = c => settled ? String(totals[c]||0) : "–";
    return '<div class="ucl-tie">'
      + '<div class="ucl-tie-team">' + crest(codes[0],true) + '<span class="name">' + esc(teamFull(codes[0])) + '</span><span class="ucl-tie-score">' + score(codes[0]) + '</span></div>'
      + '<div class="ucl-tie-team">' + crest(codes[1],true) + '<span class="name">' + esc(teamFull(codes[1])) + '</span><span class="ucl-tie-score">' + score(codes[1]) + '</span></div>'
      + '<div class="ucl-tie-meta">' + (group.length>1 ? 'Two-leg tie' : 'Single match') + (settled ? ' · ' + settled + '/' + group.length + ' played' : ' · fixture set') + '</div></div>';
  }

  function uclBracket(){
    const rounds = [
      {mw:9,label:"Play-offs",slots:8},
      {mw:10,label:"Round of 16",slots:8},
      {mw:11,label:"Quarter-finals",slots:4},
      {mw:12,label:"Semi-finals",slots:2},
      {mw:13,label:"Final",slots:1}
    ];
    const cols = rounds.map((r,idx) => {
      const groups = uclRoundGroups(r.mw);
      const n = Math.max(groups.length, groups.length?0:r.slots);
      let cards = "";
      for(let i=0;i<n;i++) cards += uclTie(groups[i]);
      return '<div class="ucl-br-col' + (idx===4?' ucl-br-final':'') + '"><div class="ucl-br-title"><b>' + r.label + '</b><span>' + (groups.length?groups.length+' ties':'TBD') + '</span></div>' + cards + '</div>';
    }).join("");
    return '<section class="panel"><div class="panel-h"><h3>Road to Final · Knockout Chart</h3><small>fills automatically as ties are published</small></div>'
      + '<div class="ucl-bracket"><div class="ucl-bracket-scroll"><div class="ucl-bracket-grid">' + cols + '</div></div></div></section>';
  }

  function viewCompetitionUCL(){
    return '<section class="ucl-card ucl-comp-intro"><span class="ey">Competition</span><h2>One table. Then every round becomes a knockout night.</h2>'
      + '<p>The 36-club league phase determines who goes straight to the Round of 16, who enters the play-offs, and whose European campaign ends. The knockout chart below fills itself as the competition progresses.</p></section>'
      + uclRoad() + uclLeagueTablePanel() + uclBracket() + scorersPanel() + crestPanel();
  }

  function uclBuildChrome(){
    const app = document.getElementById("app");
    if(!app) return;
    const oldHdr = app.querySelector(".hdr");
    if(oldHdr) oldHdr.style.display = "none";

    let nav = app.querySelector(".nav");
    if(nav && !nav.dataset.uclBuilt){
      nav.dataset.uclBuilt = "1";
      nav.innerHTML = [
        ["home","Home"],
        ["fx","Fixtures"],
        ["competition","Competition"],
        ["lb","Scoreboard"],
        ["bt","Betable"],
        ["fz","Fanzone"],
        ["ru","Rules"]
      ].map(x => '<button data-v="' + x[0] + '" onclick="go(\'' + x[0] + '\')">' + x[1] + '</button>').join("");
    }

    const authMark = document.querySelector("#ovAuth .mark");
    const authTitle = document.querySelector("#ovAuth h2");
    if(authMark) authMark.textContent = "UEFA Champions League · 2026/27";
    if(authTitle) authTitle.textContent = "Prediction League";
  }

  go = function(v){
    view = v;
    document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b.dataset.v===v));
    paint();
    window.scrollTo({top:0,behavior:"smooth"});
  };

  paint = function(){
    uclBuildChrome();
    uclSetPhaseTheme();

    if(view === "home" || view === "competition"){
      const wanted = view;
      view = "fx";
      CORE_PAINT();
      view = wanted;
      const host = document.getElementById("view");
      if(host) host.innerHTML = wanted==="home" ? viewHomeUCL() : viewCompetitionUCL();
      document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b.dataset.v===wanted));
      tick();
      return;
    }
    CORE_PAINT();
    document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b.dataset.v===view));
  };

  uclBuildChrome();
  view = "home";
  uclSetPhaseTheme();
})();
