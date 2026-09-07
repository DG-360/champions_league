/* Matchday Spotlight v2 — concise human football notes only. */
(() => {
  "use strict";
  let data = {};
  let busy = false;

  const esc2 = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const curView = () => (typeof view!=="undefined" ? view : null);

  function items(){ return Array.isArray(data.items) ? data.items : Object.values(data.items||{}); }

  function html(){
    const arr=items().slice(0,3);
    if(!arr.length) return "";
    return '<section class="ucl-card ucl-spotlight ucl-spotlight-v2" data-spotlight-v2="1">'
      +'<div class="ucl-card-h"><span>Matchday Spotlight</span><b>Stories worth knowing</b></div>'
      +'<div class="ucl-spotlight-grid">'
      +arr.map(x=>{
        const facts=(Array.isArray(x.facts)?x.facts:Object.values(x.facts||{})).filter(Boolean).slice(0,3);
        return '<article class="ucl-fact">'
          +'<div class="ucl-fact-match">'+esc2(x.home)+' <span>vs</span> '+esc2(x.away)+'</div>'
          +'<ul class="ucl-fact-list">'+facts.map(f=>'<li>'+esc2(f)+'</li>').join('')+'</ul>'
          +'</article>';
      }).join('')
      +'</div></section>';
  }

  function place(){
    if(busy || curView()!=="home") return;
    const host=document.getElementById('view');
    if(!host) return;
    const current=host.querySelector('.ucl-spotlight');
    if(current?.dataset.spotlightV2==='1') return;
    const out=html();
    if(!out){ if(current) current.remove(); return; }
    busy=true;
    if(current) current.remove();
    const dash=host.querySelector('.ucl-dashboard-grid');
    if(dash) dash.insertAdjacentHTML('afterend',out);
    busy=false;
  }

  if(typeof ref==='function') ref('weeklySpotlight').on('value',s=>{data=s.val()||{};requestAnimationFrame(place);});
  const mo=new MutationObserver(()=>requestAnimationFrame(place));
  mo.observe(document.documentElement,{subtree:true,childList:true});
  requestAnimationFrame(place);
})();