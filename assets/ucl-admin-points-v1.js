/* One-time admin point adjustment.
   Admin may award positive points to each player once. The award is stored
   separately from match scoring and protected by a Firebase transaction. */
(() => {
  "use strict";

  let pointAdjustments = {};
  const CORE_TALLIES = typeof tallies === "function" ? tallies : null;
  if (!CORE_TALLIES || typeof ref !== "function") return;

  function ensureStyles(){
    if(document.getElementById("uclAdminPointsStyle")) return;
    const s=document.createElement("style");
    s.id="uclAdminPointsStyle";
    s.textContent=`
      .admin-points-panel{margin-top:18px!important}
      .admin-points-note{padding:13px 16px;color:#aebbd8;font-size:11px;line-height:1.55;border-bottom:1px solid rgba(180,200,240,.08)}
      .admin-point-list{padding:5px 14px 13px}
      .admin-point-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(180,200,240,.08)}
      .admin-point-row:last-child{border-bottom:0}.admin-point-row.used{opacity:.78}
      .admin-point-name{flex:1;min-width:130px}.admin-point-name b{display:block;color:#fff;font-size:12px}.admin-point-name small{display:block;color:#8ea0c8;font-size:9.5px;margin-top:2px}
      .admin-point-input{width:70px;height:34px;padding:0 9px;background:#071747;border:1px solid rgba(140,183,255,.22);border-radius:9px;color:#fff;outline:none;text-align:center}
      .admin-point-input:focus{border-color:#6abdf4;box-shadow:0 0 0 3px rgba(106,189,244,.12)}
      .admin-point-award{white-space:nowrap}.admin-point-used{font-size:10px;font-weight:800;color:#c58af7;white-space:nowrap}
      @media(max-width:620px){.admin-point-row{flex-wrap:wrap}.admin-point-name{min-width:calc(100% - 42px)}.admin-point-input{margin-left:32px}.admin-point-award{flex:1}}
    `;
    document.head.appendChild(s);
  }

  function adjustmentPoints(pid){
    const a = pointAdjustments && pointAdjustments[pid];
    return a && Number.isFinite(Number(a.points)) ? Math.max(0, Number(a.points)) : 0;
  }

  tallies = function(){
    const t = CORE_TALLIES();
    Object.keys(t || {}).forEach(pid => {
      const extra = adjustmentPoints(pid);
      if (!extra) return;
      t[pid].pts = (Number(t[pid].pts) || 0) + extra;
      t[pid].adminAdjustment = extra;
    });
    return t;
  };

  function requestPaint(){
    if (typeof schedulePaint === "function") schedulePaint();
    else if (typeof paint === "function") requestAnimationFrame(() => paint());
  }

  ref("pointAdjustments").on("value", s => {
    pointAdjustments = s.val() || {};
    if (typeof me !== "undefined" && me) requestPaint();
  });

  function safeId(s){ return String(s || "").replace(/[^A-Za-z0-9_-]/g, "_"); }

  function avatarHtml(p){
    const c = typeof colr === "function" ? colr(p.ci || 0) : "#6ABDF4";
    if(p.photo){
      const src=String(p.photo).replace(/&/g,"&amp;").replace(/"/g,"%22");
      return '<span class="av sm has-photo" style="--c:'+c+';background-image:url(&quot;'+src+'&quot;)"></span>';
    }
    return '<span class="av sm" style="--c:'+c+'">'+esc(initials(p.name))+'</span>';
  }

  function adminPointsPanel(){
    if (typeof isAdmin === "undefined" || !isAdmin || typeof players === "undefined") return "";
    const t = tallies();
    const rows = Object.keys(players)
      .sort((a,b) => String(players[a]?.name || "").localeCompare(String(players[b]?.name || "")))
      .map(pid => {
        const p = players[pid] || {};
        const used = pointAdjustments && pointAdjustments[pid];
        const total = t[pid] ? Number(t[pid].pts) || 0 : 0;
        const sid = safeId(pid);
        if (used){
          return '<div class="admin-point-row used">'+avatarHtml(p)
            + '<div class="admin-point-name"><b>'+esc(p.name || "Player")+'</b><small>'+total+' total points</small></div>'
            + '<span class="admin-point-used">+'+adjustmentPoints(pid)+' awarded · used</span></div>';
        }
        return '<div class="admin-point-row">'+avatarHtml(p)
          + '<div class="admin-point-name"><b>'+esc(p.name || "Player")+'</b><small>'+total+' total points</small></div>'
          + '<input class="admin-point-input" id="adminPts_'+sid+'" type="number" min="1" max="100" step="1" inputmode="numeric" placeholder="Pts">'
          + '<button class="abtn admin-point-award" type="button" onclick="awardAdminPoints(\''+String(pid).replace(/'/g,"\\'")+'\')">Award once</button></div>';
      }).join("");

    return '<section class="panel admin-points-panel" id="adminPointsPanel">'
      + '<div class="panel-h"><h3>One-time point adjustment</h3><small>admin only · once per player</small></div>'
      + '<div class="admin-points-note">For fairness adjustments such as a late joiner. The award changes total points only; it does not create fake match predictions or exact-score records. Each player can receive this adjustment once.</div>'
      + '<div class="admin-point-list">'+rows+'</div></section>';
  }

  function renderAdminPointsPanel(){
    const old=document.getElementById("adminPointsPanel");
    if(old) old.remove();
    if (typeof view === "undefined" || view !== "lb" || typeof isAdmin === "undefined" || !isAdmin) return;
    const host=document.getElementById("view");
    if(host) host.insertAdjacentHTML("beforeend",adminPointsPanel());
  }

  window.awardAdminPoints = function(pid){
    if (typeof isAdmin === "undefined" || !isAdmin || !players?.[pid]) return;
    if(pointAdjustments?.[pid]) return toast("This player already received their one-time adjustment","bad");
    const el=document.getElementById("adminPts_"+safeId(pid));
    const points=Math.floor(Number(el?.value));
    if(!Number.isFinite(points)||points<1||points>100) return toast("Enter a point amount from 1 to 100","bad");
    const name=players[pid].name||"this player";
    if(!confirm("Award +"+points+" points to "+name+"?\n\nThis can only be done once for this player.")) return;

    ref("pointAdjustments/"+pid).transaction(current => {
      if(current) return;
      return {points,at:Date.now(),reason:"Admin fairness adjustment"};
    },(error,committed)=>{
      if(error) return toast("Could not save the point adjustment","bad");
      if(!committed) return toast("This player already received their one-time adjustment","bad");
      toast(name+" received +"+points+" points","good");
    });
  };

  ensureStyles();
  const BASE_PAINT = typeof paint === "function" ? paint : null;
  if(BASE_PAINT){
    paint=function(){
      const out=BASE_PAINT.apply(this,arguments);
      requestAnimationFrame(renderAdminPointsPanel);
      return out;
    };
  }
  requestAnimationFrame(renderAdminPointsPanel);
})();