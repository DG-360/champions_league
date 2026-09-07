/* Profile photos + weekly home spotlight. Presentation/data-extension layer only. */
(() => {
  "use strict";
  let spotlight = {};
  if (typeof ref === "function") ref("weeklySpotlight").on("value", s => { spotlight = s.val() || {}; if (window.me) paint(); });

  const escAttr = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function playerByName(name){ return Object.entries(window.players||{}).find(([,p]) => p && p.name === name); }
  function putPhoto(el,p){
    if(!el||!p) return;
    if(p.photo){
      el.classList.add("has-photo");
      el.style.backgroundImage=`url("${String(p.photo).replace(/"/g,"%22")}")`;
      el.textContent="";
    }else{
      el.classList.remove("has-photo"); el.style.backgroundImage="";
    }
  }
  function decorateAvatars(){
    if(window.me && players[me]) putPhoto(document.getElementById("uAv"),players[me]);
    document.querySelectorAll('.lb-row').forEach(r=>{ const n=r.querySelector('.who2 b')?.childNodes?.[0]?.textContent?.trim(); const hit=playerByName(n); if(hit) putPhoto(r.querySelector('.av'),hit[1]); });
    document.querySelectorAll('.pa-row').forEach(r=>{ const n=r.querySelector('.pa-nm')?.childNodes?.[0]?.textContent?.trim(); const hit=playerByName(n); if(hit) putPhoto(r.querySelector('.av'),hit[1]); });
    document.querySelectorAll('.who-b').forEach(r=>{ const txt=[...r.querySelectorAll('*')].map(x=>x.textContent.trim()).find(t=>playerByName(t)); const hit=playerByName(txt); if(hit) putPhoto(r.querySelector('.av'),hit[1]); });
  }

  function ensurePhotoControl(){
    const bar=document.querySelector('.ubar'); if(!bar||bar.querySelector('.profile-photo-btn')) return;
    const b=document.createElement('button'); b.className='ico profile-photo-btn'; b.title='Upload profile photo'; b.textContent='📷'; b.onclick=choosePhoto;
    const color=bar.querySelector('button[title*="player color"]:not(#uAv)');
    bar.insertBefore(b,color||bar.lastElementChild);
    const av=document.getElementById('uAv'); if(av){ av.title='Upload profile photo'; av.onclick=choosePhoto; }
  }

  function choosePhoto(){
    if(!window.me||!players[me]) return;
    const input=document.createElement('input'); input.type='file'; input.accept='image/*';
    input.onchange=async()=>{
      const f=input.files&&input.files[0]; if(!f) return;
      try{
        const data=await compress(f,256,.82);
        await ref(`players/${me}/photo`).set(data);
        toast('Profile photo updated','good');
      }catch(e){ toast('Could not save profile photo','bad'); }
    };
    input.click();
  }
  function compress(file,max,q){
    return new Promise((resolve,reject)=>{
      const fr=new FileReader(); fr.onerror=reject; fr.onload=()=>{
        const im=new Image(); im.onerror=reject; im.onload=()=>{
          const scale=Math.min(1,max/Math.max(im.width,im.height)), w=Math.max(1,Math.round(im.width*scale)), h=Math.max(1,Math.round(im.height*scale));
          const c=document.createElement('canvas'); c.width=w;c.height=h; const x=c.getContext('2d'); x.drawImage(im,0,0,w,h); resolve(c.toDataURL('image/jpeg',q));
        }; im.src=fr.result;
      }; fr.readAsDataURL(file);
    });
  }

  function spotlightHtml(){
    const items=Array.isArray(spotlight.items)?spotlight.items:Object.values(spotlight.items||{});
    if(!items.length) return '';
    return '<section class="ucl-card ucl-spotlight"><div class="ucl-card-h"><span>Matchday Spotlight</span><b>What everyone is talking about</b></div>'
      + '<div class="ucl-spotlight-grid">' + items.slice(0,3).map((x,i)=>'<article class="ucl-fact">'
      + '<div class="ucl-fact-no">0'+(i+1)+'</div><div class="ucl-fact-match">'+escAttr(x.home)+' <span>vs</span> '+escAttr(x.away)+'</div>'
      + '<h3>'+escAttr(x.headline||'A European night worth watching')+'</h3>'
      + '<p>'+escAttr(x.why||'One of this matchday’s most-followed fixtures.')+'</p>'
      + (x.source?'<small>'+escAttr(x.source)+'</small>':'')+'</article>').join('') + '</div>'
      + '<div class="ucl-spotlight-foot">Updated once per matchweek, the day before the first kickoff · based on recent news volume and public interest.</div></section>';
  }
  function injectSpotlight(){
    if(window.view!=="home") return;
    const host=document.getElementById('view'); if(!host||host.querySelector('.ucl-spotlight')) return;
    const dash=host.querySelector('.ucl-dashboard-grid'); if(dash) dash.insertAdjacentHTML('afterend',spotlightHtml());
  }

  const BASE=window.paint;
  if(typeof BASE==='function') window.paint=function(){ const out=BASE.apply(this,arguments); requestAnimationFrame(()=>{ensurePhotoControl();decorateAvatars();injectSpotlight();}); return out; };
  const mo=new MutationObserver(()=>{ensurePhotoControl();decorateAvatars();injectSpotlight();});
  mo.observe(document.documentElement,{subtree:true,childList:true});
  requestAnimationFrame(()=>{ensurePhotoControl();decorateAvatars();injectSpotlight();});
})();