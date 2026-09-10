/* One-time admin point adjustment.
   - Admin may award a positive number of points to each player once.
   - The award is stored separately from match scoring so the original scoring
     record stays intact.
   - A Firebase transaction enforces the one-award-only rule even if two admin
     sessions act at the same time. */
(() => {
  "use strict";

  let pointAdjustments = {};
  const CORE_TALLIES = typeof tallies === "function" ? tallies : null;
  if (!CORE_TALLIES || typeof ref !== "function") return;

  function adjustmentPoints(pid){
    const a = pointAdjustments && pointAdjustments[pid];
    return a && Number.isFinite(Number(a.points)) ? Math.max(0, Number(a.points)) : 0;
  }

  /* Add discretionary points only to total points. Exact-score counts, match
     counts, round stats and Champions League bonus accounting remain untouched. */
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
        const c = typeof colr === "function" ? colr(p.ci || 0) : "#6ABDF4";
        const av = p.photo
          ? '<span class="av sm has-photo" style="--c:'+c+';background-image:url(&quot;'+String(p.photo).replace(/&/g,"&amp;").replace(/"/g,"%22")+'&quot;)"></span>'
          : '<span class="av sm" style="--c:'+c+'">'+(typeof esc === "function" ? esc(initials(p.name)) : initials(p.name))+'</span>';

        if (used){
          const n = adjustmentPoints(pid);
          return '<div class="admin-point-row used">'
            + av
            + '<div class="admin-point-name"><b>'+(typeof esc === "function" ? esc(p.name || "Player") : String(p.name || "Player"))+'</b><small>'+total+' total points</small></div>'
            + '<span class="admin-point-used">+'+n+' awarded · used</span>'
            + '</div>';
        }

        return '<div class="admin-point-row">'
          + av
          + '<div class="admin-point-name"><b>'+(typeof esc === "function" ? esc(p.name || "Player") : String(p.name || "Player"))+'</b><small>'+total+' total points</small></div>'
          + '<input class="admin-point-input" id="adminPts_'+sid+'" type="number" min="1" max="100" step="1" inputmode="numeric" placeholder="Pts" aria-label="Points to award to '+(typeof esc === "function" ? esc(p.name || "player") : String(p.name || "player"))+'">'
          + '<button class="abtn admin-point-award" type="button" onclick="awardAdminPoints(\''+String(pid).replace(/'/g,"\\'")+'\')">Award once</button>'
          + '</div>';
      }).join("");

    return '<section class="panel admin-points-panel" id="adminPointsPanel">'
      + '<div class="panel-h"><h3>One-time point adjustment</h3><small>admin only · once per player</small></div>'
      + '<div class="admin-points-note">Use this only for a fairness adjustment, such as a player who joined after matches had already been played. Once awarded, that player cannot receive another manual adjustment.</div>'
      + '<div class="admin-point-list">'+rows+'</div>'
      + '</section>';
  }

  function renderAdminPointsPanel(){
    if (typeof view === "undefined" || view !== "lb") return;
    const host = document.getElementById("view");
    if (!host) return;
    const old = document.getElementById("adminPointsPanel");
    if (old) old.remove();
    if (typeof isAdmin === "undefined" || !isAdmin) return;
    host.insertAdjacentHTML("beforeend", adminPointsPanel());
  }

  window.awardAdminPoints = function(pid){
    if (typeof isAdmin === "undefined" || !isAdmin) return;
    if (!players || !players[pid]) return;
    if (pointAdjustments && pointAdjustments[pid]){
      if (typeof toast === "function") toast("This player already received their one-time adjustment", "bad");
      return;
    }

    const el = document.getElementById("adminPts_" + safeId(pid));
    const points = Math.floor(Number(el && el.value));
    if (!Number.isFinite(points) || points < 1 || points > 100){
      if (typeof toast === "function") toast("Enter a point amount from 1 to 100", "bad");
      return;
    }

    const name = players[pid].name || "this player";
    if (!confirm("Award +" + points + " points to " + name + "?\n\nThis is a one-time adjustment and cannot be awarded again from the admin panel.")) return;

    const target = ref("pointAdjustments/" + pid);
    target.transaction(current => {
      if (current) return;
      return { points, at: Date.now(), reason: "Admin fairness adjustment" };
    }, (error, committed) => {
      if (error){
        if (typeof toast === "function") toast("Could not save the point adjustment", "bad");
        return;
      }
      if (!committed){
        if (typeof toast === "function") toast("This player already received their one-time adjustment", "bad");
        return;
      }
      if (typeof toast === "function") toast(name + " received +" + points + " points", "good");
    });
  };

  /* Add the admin panel after actual paints only; no DOM observer. */
  const BASE_PAINT = typeof paint === "function" ? paint : null;
  if (BASE_PAINT){
    paint = function(){
      const out = BASE_PAINT.apply(this, arguments);
      requestAnimationFrame(renderAdminPointsPanel);
      return out;
    };
  }

  requestAnimationFrame(renderAdminPointsPanel);
})();