/* Matchday Spotlight v3: concise, matchup-specific, no source/analytics copy. */
(() => {
  "use strict";
  let data = {};

  const esc2 = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const currentView2 = () => (typeof view !== "undefined" ? view : null);

  function render(){
    if(currentView2()!=="home") return;
    const host=document.getElementById('view');
    if(!host) return;
    host.querySelectorAll('.ucl-spotlight').forEach(el=>el.remove());
    const items=Array.isArray(data.items)?data.items:Object.values(data.items||{});
    if(!items.length) return;
    const html='<section class="ucl-card ucl-spotlight ucl-spotlight-v3">'
      +'<div class="ucl-card-h"><span>Matchday Spotlight</span><b>Worth knowing</b></div>'
      +'<div class="ucl-spotlight-grid">'
      +items.slice(0,3).map(x=>{
        const facts=Array.isArray(x.facts)?x.facts:Object.values(x.facts||{});
        return '<article class="ucl-fact">'
          +'<div class="ucl-fact-match">'+esc2(x.home)+' <span>vs</span> '+esc2(x.away)+'</div>'
          +(facts.length?'<ul class="ucl-fact-list">'+facts.slice(0,3).map(f=>'<li>'+esc2(f)+'</li>').join('')+'</ul>':'')
          +'</article>';
      }).join('')
      +'</div></section>';
    const dash=host.querySelector('.ucl-dashboard-grid');
    if(dash) dash.insertAdjacentHTML('afterend',html);
  }

  if(typeof ref==='function') ref('weeklySpotlight').on('value',s=>{data=s.val()||{};requestAnimationFrame(render);});
  const mo=new MutationObserver(()=>requestAnimationFrame(render));
  mo.observe(document.documentElement,{subtree:true,childList:true});
  requestAnimationFrame(render);
})();