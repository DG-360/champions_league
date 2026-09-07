/* Betable recommendation layer v2.
   Recommendations now use the exact H/D/A model probabilities shown in Match Scan.
   Individual: strongest HOME/AWAY team strictly above 80%.
   Combo: every HOME/AWAY team strictly above 66%, shown only when 3+ qualify. */
(() => {
  "use strict";

  const INDIVIDUAL_MIN = 0.80;
  const COMBO_MIN = 0.66;

  function teamCandidate(a){
    if(!a || !a.model || !a.model.p) return null;
    const h = Number(a.model.p.H)||0;
    const away = Number(a.model.p.A)||0;
    if(h >= away){
      return {analysis:a, side:"H", team:a.m.h, prob:h, pick:teamNm(a.m.h)+" to win"};
    }
    return {analysis:a, side:"A", team:a.m.a, prob:away, pick:teamNm(a.m.a)+" to win"};
  }

  function pct(x){ return Math.round(Math.max(0,Math.min(1,Number(x)||0))*100); }

  function comboLeg(x,i){
    const a=x.analysis;
    return '<div class="bt-leg"><span class="num">'+(i+1)+'</span><div class="main">'
      +'<div class="game">'+esc(teamNm(a.m.h))+' v '+esc(teamNm(a.m.a))+'</div>'
      +'<div class="pick">'+esc(x.pick)+'</div>'
      +'</div><span class="bt-conf">'+pct(x.prob)+'%</span></div>';
  }

  function individualCard(x){
    const a=x.analysis;
    return '<div class="bt-card hot"><div class="game">'+esc(teamNm(a.m.h))+' v '+esc(teamNm(a.m.a))+'</div>'
      +'<div class="pick">'+esc(x.pick)+'</div>'
      +'<div class="meta"><span class="bt-pill">BEST PICK</span><span>'+pct(x.prob)+'%</span></div></div>';
  }

  function buildView(){
    const week=betableMW();
    const upcoming=(MW[week-1]||[]).filter(m=>!locked(m)&&!results[m.id]);
    const analyses=upcoming.map(betAnalysis).sort((a,b)=>(b.modelProb-a.modelProb)||(b.rating-a.rating));
    const teamPicks=analyses.map(teamCandidate).filter(Boolean).sort((a,b)=>b.prob-a.prob);

    const individual = teamPicks.find(x=>x.prob>INDIVIDUAL_MIN) || null;
    const comboCandidates = teamPicks.filter(x=>x.prob>COMBO_MIN);
    const combo = comboCandidates.length>=3 ? comboCandidates : [];

    const gate=betModelThreshold();
    const modelName=(modelMeta&&modelMeta.selectedModel)||null;
    const modelReady=!!modelName&&analyses.some(a=>a.model);
    const modelStatus=modelReady
      ? esc(modelName)+' · recommendations use the H/D/A probabilities below'
      : 'Model pending';

    const comboHtml=combo.length
      ? '<div class="bt-good"><b>COMBO · '+combo.length+' TEAMS</b><div class="bt-sub">Every team above 66% model win probability.</div></div><div class="bt-combo">'+combo.map(comboLeg).join('')+'</div>'
      : '<div class="bt-risk"><b>NO COMBO</b><div class="bt-sub">A combo appears when at least 3 teams are above 66% to win.</div></div>';

    const individualHtml=individual
      ? '<div class="bt-grid">'+individualCard(individual)+'</div>'
      : '<div class="bt-empty">No team is above 80% to win this matchday.</div>';

    const scanHtml=analyses.length
      ? '<div class="bt-list">'+analyses.map(betScanRow).join('')+'</div>'
      : '<div class="bt-empty">No open '+esc(roundName(week))+' fixtures.</div>';

    return '<div class="panel"><div class="bt-hero"><h2>BETABLE · '+esc(roundName(week))+'</h2>'
      +'<p>Model probabilities · simple thresholds</p></div>'
      +'<div class="bt-model"><b>'+modelStatus+'</b></div>'
      +'<div class="panel-h"><h3>Combo</h3><small>3+ teams · &gt;66%</small></div>'+comboHtml
      +'<div class="panel-h"><h3>Individual pick</h3><small>best team · &gt;80%</small></div>'+individualHtml
      +'<div class="panel-h"><h3>Match scan</h3><small>H · D · A</small></div>'+scanHtml
      +'</div>'+betContextPanel(week);
  }

  window.viewBetable = buildView;
})();