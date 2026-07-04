/* INPUT/OUTPUT — algorithmic branch / root / rhizome generator.
   100% client-side, no AI, no server. Faithful port of the Python generator
   (branchgen.py) to Canvas, plus creative extensions: wind/gravity, radial
   symmetry, growth animation, movable center, draggable main-limb handles. */

'use strict';
let AR = [140,90];                             // aspect ratio (w,h)
let ASPECT = AR[1]/AR[0];                       // height/width

/* ---------- seeded PRNG (reproducible per seed) ---------- */
let RNG = mulberry32(1);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function uni(a,b){return a+(b-a)*RNG();}
function gauss(mu,sig){let u=0,v=0;while(u===0)u=RNG();while(v===0)v=RNG();return mu+sig*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function pm(){return RNG()<0.5?-1:1;}          // ±1

function reachFn(cx,cy,ang,W,H){
  const dx=Math.cos(ang),dy=Math.sin(ang);const ts=[];
  if(dx>1e-9)ts.push((W-cx)/dx);else if(dx<-1e-9)ts.push((0-cx)/dx);
  if(dy>1e-9)ts.push((H-cy)/dy);else if(dy<-1e-9)ts.push((0-cy)/dy);
  let m=Infinity;for(const t of ts)if(t>0&&t<m)m=t;return m===Infinity?Math.hypot(W,H):m;
}

/* ---------- parameters ---------- */
const GROUPS = [
  ["Composition", [
    ["n_main","Main limbs",1,40,1,9],
    ["center_radius","Center fill scatter",0,180,1,16],
    ["center_jitter","Center irregularity",0,1.2,0.02,0.35],
    ["limb_swirl","Limb swirl",0,0.9,0.02,0.35],
  ]],
  ["Limbs", [
    ["init_width","Limb thickness",4,60,1,32],
    ["init_length","Limb length",60,600,10,150],
    ["taper","Taper (1=slow)",0.965,0.998,0.001,0.993],
    ["wander","Wobble",0,0.25,0.005,0.03],
    ["curl","Curl / S-bend",0,0.15,0.005,0.02],
  ]],
  ["Motion", [
    ["radial_pull","Outward pull",0,0.06,0.002,0.026],
    ["main_pull","Main-limb straightness",0.3,3,0.1,1.5],
    ["wind_x","Wind →",-0.8,0.8,0.02,0],
    ["wind_y","Wind ↓ (gravity)",-0.8,0.8,0.02,0],
  ]],
  ["Forks", [
    ["fork_angle","Fork spread",0.2,1.1,0.02,0.52],
    ["fork_angle_var","Fork variation",0,0.6,0.02,0.28],
    ["fork_len_ratio","Fork length ratio",0.55,0.92,0.01,0.80],
    ["fork_wid_ratio","Fork width ratio",0.55,0.95,0.01,0.82],
    ["third_fork_prob","3-way fork chance",0,0.6,0.02,0.22],
    ["fork_asymmetry","Limb hierarchy (tree)",0,1,0.02,0.55],
  ]],
  ["Twigs / hairs", [
    ["side_prob","Twig density",0,0.12,0.002,0.06],
    ["twig_floor","Twig spawn floor",1,4,0.1,1.3],
    ["side_angle","Twig angle",0.2,1.4,0.02,0.7],
    ["side_wid_ratio","Twig thickness",0.3,0.85,0.02,0.42],
    ["side_len_ratio","Twig length",0.2,0.85,0.02,0.35],
  ]],
  ["Detail / render", [
    ["max_depth","Recursion depth",4,18,1,14],
    ["min_width","Finest twig",0.4,2.5,0.05,1.1],
    ["step_px","Smoothness (low=fine)",2,8,0.5,4],
    ["blur","Softness",0,1.6,0.1,0.8],
  ]],
];
const SLIDERS = GROUPS.flatMap(g=>g[1]);
const INT_KEYS = new Set(["n_main","max_depth"]);
const CAP = 1500000;

/* live state */
const P = {};                                  // current param values
SLIDERS.forEach(s=>P[s[0]]=s[5]);
let state = {
  seed:8, center_x:0.5, center_y:0.5, extra:[],
  fork_mode:"bushy", round_joints:true, soft_tips:false, white_bg:true, buds:false, editMode:true,
};
const locked = new Set();
let limbAims = [];                              // per-main-limb aim override (radians) or undefined (primary center only)
let lastCenters = [];                           // [{x,y,aims:[...]}] for handle drawing
function centersList(){ return [{x:state.center_x,y:state.center_y}, ...state.extra]; }

/* ---------- core: draw branches to a (transparent) layer ---------- */
function drawBranches(ctx, W, H, growthR){
  RNG = mulberry32(state.seed>>>0);
  const sc = W/2000;
  const step = P.step_px*sc, minw = P.min_width*sc;
  const bushy = state.fork_mode==="bushy";
  let steps = 0;
  const n = P.n_main|0, diag = Math.hypot(W,H);
  const centers = centersList(), single = centers.length===1;
  const wx = P.wind_x, wy = P.wind_y;
  const soft = state.soft_tips;
  lastCenters = [];
  // Batch segments by "color@width" so we issue ~one stroke() per width bucket
  // instead of one per segment (millions). Big speedup. Round caps still smooth.
  const buckets = new Map(); const buds = [];
  function seg(col,w,x0,y0,x1,y1){ const k=col+"@"+w; let a=buckets.get(k); if(!a){a=[];buckets.set(k,a);} a.push(x0,y0,x1,y1); }
  for(let ci=0; ci<centers.length; ci++){
    const cx = centers[ci].x*W, cy = centers[ci].y*H;
    const aimsRec = [], stack = [];
    for(let i=0;i<n;i++){
      let a = (2*Math.PI*i/n) + uni(-P.center_jitter,P.center_jitter);
      let reach = reachFn(cx,cy,a,W,H);
      if(reach < 0.10*diag){ const tx=uni(0.05,0.95)*W, ty=uni(0.05,0.95)*H; a=Math.atan2(ty-cy,tx-cx); reach=reachFn(cx,cy,a,W,H); }
      const rr = P.center_radius*sc*Math.sqrt(RNG());
      const saa = uni(0,2*Math.PI);
      const sx = cx+Math.cos(saa)*rr, sy = cy+Math.sin(saa)*rr;
      let L = Math.max(P.init_length*sc, reach*(1-P.fork_len_ratio)*uni(1.0,1.3));
      let ang0 = a + uni(-P.limb_swirl,P.limb_swirl);
      if(single && limbAims[i]!=null){ ang0 = limbAims[i]; const rr2=reachFn(cx,cy,ang0,W,H); L=Math.max(P.init_length*sc, rr2*(1-P.fork_len_ratio)*1.15); }
      aimsRec.push(ang0);
      stack.push([sx,sy,ang0, uni(0.85,1.0)*P.init_width*sc, L, 0, true]);
    }
    lastCenters.push({x:centers[ci].x, y:centers[ci].y, aims:aimsRec});
    while(stack.length && steps<CAP){
      let [x,y,ang,wid,length,depth,isMain] = stack.pop();
      if(depth>P.max_depth || wid<minw) continue;
      const curl = gauss(0,P.curl);
      let life = length; const seglen = length;
      while(life>0 && wid>minw && steps<CAP){
        ang += curl + gauss(0,P.wander);
        const desired = Math.atan2(y-cy,x-cx);
        // signed smallest angle from ang to desired, in [-π,π]. MUST use atan2(sin,cos):
        // JS "%" keeps the sign of the dividend, so (a % 2π)-π is wrong for negatives
        // (Python's floored "%" doesn't) — that mismatch was biasing growth one direction.
        const diff = Math.atan2(Math.sin(desired-ang), Math.cos(desired-ang));
        ang += P.radial_pull*diff*(isMain?P.main_pull:0.5);
        const nx = x+(Math.cos(ang)+wx)*step, ny = y+(Math.sin(ang)+wy)*step;
        if(growthR===Infinity || Math.hypot(nx-cx,ny-cy)<=growthR){
          let col = "#000";
          if(soft && wid<1.8*sc){ const c=Math.round(75*(1-wid/(1.8*sc))/8)*8; col=`rgb(${c},${c},${c})`; }
          seg(col, Math.max(1,Math.round(wid)), x,y,nx,ny);
        }
        x=nx; y=ny; wid*=P.taper; life-=step; steps++;
        if(RNG()<P.side_prob && wid>P.twig_floor*minw){
          const sa2 = ang + pm()*(P.side_angle+uni(-0.25,0.25));
          stack.push([x,y,sa2, wid*P.side_wid_ratio, seglen*P.side_len_ratio, depth+2, false]);
        }
      }
      if(!(depth<P.max_depth && wid>minw)){
        if(state.buds && (growthR===Infinity || Math.hypot(x-cx,y-cy)<=growthR)) buds.push(x,y);
      } else {
        const sp = P.fork_angle+uni(0,P.fork_angle_var);
        const base_len = seglen*P.fork_len_ratio, ew = wid;
        if(bushy){
          const cw = ew*P.fork_wid_ratio, cl = base_len*uni(0.85,1.1);
          for(const s of [-1,1]) stack.push([x,y,ang+s*sp*uni(0.7,1.2), cw*uni(0.85,1.05), cl, depth+1, isMain]);
          if(RNG()<P.third_fork_prob) stack.push([x,y,ang+uni(-0.3,0.3), cw*0.85, cl*0.85, depth+1, false]);
        } else {
          const asym = P.fork_asymmetry, side = pm();
          const dom_w = ew*(0.98-0.06*(1-asym)), dom_ang = ang-side*sp*(0.30*(1-asym)), dom_len = base_len*uni(0.9,1.05);
          stack.push([x,y,dom_ang,dom_w,dom_len,depth+1,isMain]);
          const min_w = ew*(0.82-0.34*asym), min_ang = ang+side*sp*(1+0.4*asym), min_len = base_len*(1-0.30*asym)*uni(0.85,1.05);
          stack.push([x,y,min_ang,min_w*uni(0.9,1.05),min_len,depth+1,false]);
          if(RNG()<P.third_fork_prob) stack.push([x,y,ang+pm()*sp*0.6, min_w*0.8, min_len*0.85, depth+1, false]);
        }
      }
    }
  }
  // flush buckets — one stroke per width
  ctx.lineCap = state.round_joints?"round":"butt";
  ctx.lineJoin = state.round_joints?"round":"miter";
  for(const [k,arr] of buckets){
    const at=k.indexOf("@");
    ctx.strokeStyle = k.slice(0,at); ctx.lineWidth = +k.slice(at+1);
    ctx.beginPath();
    for(let i=0;i<arr.length;i+=4){ ctx.moveTo(arr[i],arr[i+1]); ctx.lineTo(arr[i+2],arr[i+3]); }
    ctx.stroke();
  }
  if(buds.length){ ctx.fillStyle="#000"; const br=Math.max(1.3,2.4*sc); for(let i=0;i<buds.length;i+=2){ ctx.beginPath(); ctx.arc(buds[i],buds[i+1],br,0,7); ctx.fill(); } }
}

/* ---------- scene: background + symmetry composite + blur ---------- */
let _layer=null;
function layerCanvas(W,H){ if(!_layer){_layer=document.createElement("canvas");} if(_layer.width!==W||_layer.height!==H){_layer.width=W;_layer.height=H;} return _layer; }

function renderScene(ctx, W, H, opts){
  opts = opts||{};
  const transparent = opts.transparent||false;
  const growthR = (opts.growth==null||opts.growth>=1) ? Infinity : opts.growth*Math.hypot(W,H);
  const layer = layerCanvas(W,H);
  const lctx = layer.getContext("2d");
  lctx.clearRect(0,0,W,H);
  drawBranches(lctx,W,H,growthR);

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  if(!transparent){ ctx.fillStyle="#fff"; ctx.fillRect(0,0,W,H); }
  if(P.blur>0) ctx.filter = `blur(${(P.blur*(W/2000)).toFixed(2)}px)`;
  ctx.drawImage(layer,0,0);
  ctx.filter = "none";
}

/* ---------- display ---------- */
const PW = 1500; let PH = Math.round(PW*ASPECT);
const cvs = document.getElementById("c");
const ov  = document.getElementById("ov");
cvs.width=PW; cvs.height=PH;
const cctx = cvs.getContext("2d");
let renderTimer=null;
function scheduleRender(){ if(renderTimer)cancelAnimationFrame(renderTimer); renderTimer=requestAnimationFrame(renderDisplay); }
function renderDisplay(){
  const t0=performance.now();
  renderScene(cctx,PW,PH,{transparent:!state.white_bg});
  drawHandles();
  setStatus(`rendered ${Math.round(performance.now()-t0)} ms · seed ${state.seed}`);
}

/* ---------- main-limb handles overlay ---------- */
function sizeOverlay(){ const r=cvs.getBoundingClientRect(); ov.width=Math.max(1,Math.round(r.width)); ov.height=Math.max(1,Math.round(r.height)); }
function drawHandles(){ sizeOverlay(); ov.getContext("2d").clearRect(0,0,ov.width,ov.height); }  // invisible: overlay only captures clicks
/* interactions: grab the CENTER by clicking on it; grab a LIMB by clicking on it. No visible UI.
   shift-click adds a center. All disabled when Edit is off. */
let drag=null, hovering=false;
function ovPos(e){ const r=ov.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top, r}; }
function setCenter(ci,fx,fy){ fx=Math.min(1,Math.max(0,fx)); fy=Math.min(1,Math.max(0,fy)); if(ci===0){state.center_x=fx;state.center_y=fy;} else {state.extra[ci-1]={x:fx,y:fy};} }
function pick(p){ // returns {type:'center',ci} | {type:'limb',li} | null
  const list=centersList();
  let ci=-1,bd=1e9; list.forEach((C,idx)=>{const d=Math.hypot(C.x*p.r.width-p.x,C.y*p.r.height-p.y); if(d<bd){bd=d;ci=idx;}});
  if(bd<24) return {type:"center",ci};
  if(list.length===1 && lastCenters[0]){
    const C=lastCenters[0], cxD=C.x*p.r.width, cyD=C.y*p.r.height;
    const dist=Math.hypot(p.x-cxD,p.y-cyD);
    if(dist>18){ const ca=Math.atan2(p.y-cyD,p.x-cxD); let li=-1,ba=0.22;
      C.aims.forEach((a,idx)=>{ const da=Math.abs(Math.atan2(Math.sin(ca-a),Math.cos(ca-a))); if(da<ba){ba=da;li=idx;} });
      if(li>=0) return {type:"limb",li};
    }
  }
  return null;
}
ov.addEventListener("mousedown",e=>{
  if(!state.editMode) return;
  const p=ovPos(e);
  if(e.shiftKey){ state.extra.push({x:p.x/p.r.width,y:p.y/p.r.height}); drag={type:"center",ci:state.extra.length}; scheduleRender(); return; }
  const hit=pick(p); if(hit) drag=hit;   // only act if you actually grabbed something
});
window.addEventListener("mousemove",e=>{
  if(!state.editMode){ ov.style.cursor="default"; return; }
  const p=ovPos(e);
  if(!drag){ ov.style.cursor = pick(p)?"grab":"default"; return; }
  ov.style.cursor="grabbing";
  if(drag.type==="limb"){ const C=centersList()[0]; const cxD=C.x*p.r.width, cyD=C.y*p.r.height; limbAims[drag.li]=Math.atan2(p.y-cyD,p.x-cxD); scheduleRender(); }
  else { setCenter(drag.ci, p.x/p.r.width, p.y/p.r.height); scheduleRender(); }
});
window.addEventListener("mouseup",()=>{ if(drag){drag=null; recordHistory();} });
function clearCenters(){ state.extra=[]; scheduleRender(); recordHistory(); }
function setEditMode(on){ state.editMode=on; if(!on){ state.center_x=0.5; state.center_y=0.5; state.extra=[]; limbAims=[]; scheduleRender(); recordHistory(); } else scheduleRender(); }

/* ---------- UI build ---------- */
const panel=document.getElementById("sliders");
function decimals(st){const p=String(st).split(".")[1];return p?p.length:0;}
function buildSliders(){
  let idx=0, total=SLIDERS.length;
  for(const [gname,items] of GROUPS){
    const sec=document.createElement("div"); sec.className="sec";
    const head=document.createElement("div"); head.className="sec-h"; head.textContent=gname;
    head.onclick=()=>sec.classList.toggle("collapsed");
    sec.appendChild(head);
    const body=document.createElement("div"); body.className="sec-b"; sec.appendChild(body);
    panel.appendChild(sec);                       // attach before populating so getElementById works
    for(const s of items){
      const [key,label,mn,mx,st,def]=s;
      const hue=Math.round(idx*360/total); idx++;
      const col=`hsl(${hue},75%,62%)`, dec=decimals(st);
      const row=document.createElement("div"); row.className="row";
      row.innerHTML=`<label style="color:${col}"><span><span class=lk id="lk_${key}" title="lock from Randomize">🔓</span>${label}</span><b id="v_${key}" style="color:${col}"></b></label>
        <input type=range id="${key}" min=${mn} max=${mx} step=${st} value=${P[key]}>`;
      body.appendChild(row);
      const inp=row.querySelector("input"); inp.style.accentColor=col;
      const show=()=>document.getElementById("v_"+key).textContent=(+inp.value).toFixed(dec);
      inp.addEventListener("input",()=>{ P[key]=+inp.value; show(); if(INT_KEYS.has("n_main")&&key==="n_main"){limbAims=[];} scheduleRender(); });
      row.querySelector(".lk").addEventListener("click",()=>toggleLock(key));
      show();
    }
  }
}
function toggleLock(key){ const e=document.getElementById("lk_"+key); if(locked.has(key)){locked.delete(key);e.textContent="🔓";e.classList.remove("on");}else{locked.add(key);e.textContent="🔒";e.classList.add("on");} }
function setLock(key,on){ const e=document.getElementById("lk_"+key); if(!e)return; if(on){locked.add(key);e.textContent="🔒";e.classList.add("on");}else{locked.delete(key);e.textContent="🔓";e.classList.remove("on");} }
function showVal(key){ const s=SLIDERS.find(x=>x[0]===key); document.getElementById("v_"+key).textContent=(+P[key]).toFixed(decimals(s[4])); document.getElementById(key).value=P[key]; }

/* toggles wired from HTML */
function bindToggle(id,prop){ const el=document.getElementById(id); el.checked=state[prop]; el.addEventListener("change",()=>{ state[prop]=el.checked; scheduleRender(); }); }

/* ---------- randomize (respects locks) ---------- */
function randomizeParams(){
  for(const [key,label,mn,mx,st] of SLIDERS){
    if(locked.has(key)) continue;
    const steps=Math.round((mx-mn)/st);
    let v=mn+st*Math.floor(Math.random()*(steps+1));
    P[key]=INT_KEYS.has(key)?Math.round(v):+v.toFixed(decimals(st));
    showVal(key);
  }
  limbAims=[]; scheduleRender(); recordHistory();
}
function mutateParams(){                          // nudge unlocked params ±12% of range (explore nearby)
  for(const [key,label,mn,mx,st] of SLIDERS){
    if(locked.has(key)) continue;
    let v = P[key] + (Math.random()*2-1)*(mx-mn)*0.12;
    v = Math.max(mn,Math.min(mx,v));
    v = mn + Math.round((v-mn)/st)*st;
    P[key] = INT_KEYS.has(key)?Math.round(v):+v.toFixed(decimals(st));
    showVal(key);
  }
  scheduleRender(); recordHistory();
}
function rndSeed(){ state.seed=Math.floor(Math.random()*1e6); document.getElementById("seedval").textContent=state.seed; scheduleRender(); recordHistory(); }
function setAspect(w,h){ AR=[w,h]; ASPECT=h/w; PH=Math.round(PW*ASPECT); cvs.width=PW; cvs.height=PH; fitWrap(); scheduleRender(); }
function fitWrap(){ const el=document.querySelector(".wrap"); el.style.aspectRatio=`${AR[0]}/${AR[1]}`; el.style.width=`min(100%, calc((100vh - 90px) * ${AR[0]/AR[1]}))`; }

/* ---------- style presets ---------- */
const STYLES = {
  "Root system":{n_main:9,center_radius:16,center_jitter:0.35,limb_swirl:0.35,init_width:32,init_length:150,taper:0.993,wander:0.03,curl:0.02,radial_pull:0.026,main_pull:1.5,wind_x:0,wind_y:0,fork_angle:0.52,fork_len_ratio:0.80,fork_wid_ratio:0.82,third_fork_prob:0.22,side_prob:0.06,side_wid_ratio:0.42,side_len_ratio:0.35,symmetry:1,fork_mode:"bushy"},
  "Dense tree":{n_main:22,center_radius:20,center_jitter:0.6,limb_swirl:0.2,init_width:26,init_length:300,taper:0.99,wander:0.05,curl:0.03,radial_pull:0.026,main_pull:1.4,wind_x:0,wind_y:0,fork_angle:0.64,fork_len_ratio:0.74,fork_wid_ratio:0.78,third_fork_prob:0.26,side_prob:0.05,symmetry:1,fork_mode:"bushy"},
  "Rhizome":{n_main:14,center_radius:60,center_jitter:0.9,limb_swirl:0.6,init_width:22,init_length:220,taper:0.994,wander:0.06,curl:0.05,radial_pull:0.008,main_pull:0.8,wind_x:0,wind_y:0,fork_angle:0.7,fork_len_ratio:0.82,fork_wid_ratio:0.8,third_fork_prob:0.35,side_prob:0.05,symmetry:1,fork_mode:"tree",fork_asymmetry:0.4},
  "Windswept":{n_main:10,center_radius:14,center_jitter:0.3,limb_swirl:0.3,init_width:28,init_length:180,taper:0.993,wander:0.03,curl:0.02,radial_pull:0.02,main_pull:1.4,wind_x:0.35,wind_y:0.12,fork_angle:0.5,fork_len_ratio:0.8,fork_wid_ratio:0.8,third_fork_prob:0.2,side_prob:0.05,symmetry:1,fork_mode:"bushy"},
  "Neuron":{n_main:16,center_radius:24,center_jitter:0.7,limb_swirl:0.5,init_width:16,init_length:160,taper:0.992,wander:0.09,curl:0.06,radial_pull:0.012,main_pull:1.0,wind_x:0,wind_y:0,fork_angle:0.6,fork_len_ratio:0.78,fork_wid_ratio:0.7,third_fork_prob:0.3,side_prob:0.05,symmetry:1,fork_mode:"tree",fork_asymmetry:0.7},
};
function applyStyle(name){
  const s=STYLES[name]; if(!s)return;
  for(const k in s){ if(k in P){P[k]=s[k];showVal(k);} else if(k==="fork_mode"){state.fork_mode=s[k];document.getElementById("tree_mode").checked=(s[k]==="tree");} }
  limbAims=[]; scheduleRender(); recordHistory();
}

/* ---------- presets (localStorage + file) ---------- */
function snapshot(){ return {params:{...P}, state:{...state}, locked:[...locked], center:{x:state.center_x,y:state.center_y}, ar:[...AR]}; }
function applySnapshot(o){
  if(o.params) for(const k in o.params){ if(k in P){P[k]=o.params[k];} }
  if(o.state) Object.assign(state,o.state);
  if(o.center){ state.center_x=o.center.x; state.center_y=o.center.y; }
  SLIDERS.forEach(s=>showVal(s[0]));
  SLIDERS.forEach(s=>setLock(s[0], (o.locked||[]).includes(s[0])));
  document.getElementById("seedval").textContent=state.seed;
  document.getElementById("tree_mode").checked=(state.fork_mode==="tree");
  document.getElementById("round_joints").checked=state.round_joints;
  document.getElementById("soft_tips").checked=state.soft_tips;
  document.getElementById("white_bg").checked=state.white_bg;
  document.getElementById("buds").checked=!!state.buds;
  document.getElementById("edit_mode").checked=state.editMode!==false;
  if(o.ar){ document.getElementById("aspect").value=o.ar.join(","); setAspect(o.ar[0],o.ar[1]); }
  limbAims=[]; scheduleRender(); recordHistory();
}
function savePresetFile(){
  const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob), ts=stamp();
  const a=document.createElement("a"); a.href=url; a.download=`INPUT_OUTPUT_preset_${ts}.json`; a.click(); URL.revokeObjectURL(url);
  setStatus("saved preset file");
}
function loadPresetFile(file){ if(!file)return; const r=new FileReader(); r.onload=()=>{try{applySnapshot(JSON.parse(r.result));setStatus("loaded preset");}catch(e){setStatus("bad preset: "+e);}}; r.readAsText(file); }
function saveSlot(){ const name=prompt("Preset name?","preset "+(localStorageCount()+1)); if(!name)return; const all=slotAll(); all[name]=snapshot(); localStorage.setItem("io_presets",JSON.stringify(all)); refreshSlots(); setStatus("saved slot “"+name+"”"); }
function slotAll(){ try{return JSON.parse(localStorage.getItem("io_presets")||"{}");}catch(e){return {};} }
function localStorageCount(){ return Object.keys(slotAll()).length; }
function refreshSlots(){ const sel=document.getElementById("slots"); const all=slotAll(); sel.innerHTML="<option value=''>— saved presets —</option>"+Object.keys(all).map(n=>`<option>${n}</option>`).join(""); }
function loadSlot(){ const n=document.getElementById("slots").value; if(!n)return; const all=slotAll(); if(all[n])applySnapshot(all[n]); }
function delSlot(){ const n=document.getElementById("slots").value; if(!n)return; const all=slotAll(); delete all[n]; localStorage.setItem("io_presets",JSON.stringify(all)); refreshSlots(); }

/* ---------- export PNG (hi-res) ---------- */
function exportPNG(which){
  const fw=Math.max(400,Math.min(12000, +document.getElementById("stillw").value||8400));
  const W=fw-(fw%2), H=Math.round(W*ASPECT)-(Math.round(W*ASPECT)%2);
  setStatus(`rendering ${W}×${H}…`);
  setTimeout(()=>{
    const off=document.createElement("canvas"); off.width=W; off.height=H;
    renderScene(off.getContext("2d"),W,H,{transparent:which==="transparent"});
    off.toBlob(b=>{ const url=URL.createObjectURL(b); const a=document.createElement("a"); a.href=url; a.download=`INPUT_OUTPUT_seed${state.seed}_${stamp()}${which==="transparent"?"_transparent":""}.png`; a.click(); URL.revokeObjectURL(url); setStatus(`✔ downloaded ${W}×${H} ${which}`); },"image/png");
  },30);
}

/* ---------- video (webm via MediaRecorder) + live preview ---------- */
let previewRAF=null, previewStop=false;
function frameParams(i,frames,mode,randomize){
  if(mode==="growth"){ return {growth: frames<2?1:i/(frames-1)}; }
  // seed sweep
  state.seed = (state._base??state.seed)+i;
  document.getElementById("seedval").textContent=state.seed;
  if(randomize){ for(const [key,label,mn,mx,st] of SLIDERS){ if(locked.has(key))continue; const steps=Math.round((mx-mn)/st); let v=mn+st*Math.floor(Math.random()*(steps+1)); P[key]=INT_KEYS.has(key)?Math.round(v):+v.toFixed(decimals(st)); showVal(key); } }
  return {growth:1};
}
async function previewVideo(){
  stopPreview();
  const frames=clampInt("vframes",2,600), fps=clampInt("vfps",1,60), mode=document.getElementById("vmode").value, randomize=document.getElementById("vrand").checked;
  state._base=state.seed; previewStop=false;
  let i=0;
  const tick=()=>{
    if(previewStop) return;
    const opt=frameParams(i%frames,frames,mode,randomize);
    renderScene(cctx,PW,PH,{transparent:!state.white_bg,growth:opt.growth}); drawHandles();
    setStatus(`▶ preview frame ${i%frames+1}/${frames}`);
    i++;
    previewRAF=setTimeout(()=>requestAnimationFrame(tick),1000/fps);
  };
  tick();
}
function stopPreview(){ previewStop=true; if(previewRAF){clearTimeout(previewRAF);previewRAF=null;} if(state._base!=null){state.seed=state._base;document.getElementById("seedval").textContent=state.seed;state._base=null;} }
async function exportVideo(){
  stopPreview();
  const frames=clampInt("vframes",2,600), fps=clampInt("vfps",1,60), mode=document.getElementById("vmode").value, randomize=document.getElementById("vrand").checked;
  const vw=Math.max(200,Math.min(4000,+document.getElementById("vw").value||1000));
  const W=vw-(vw%2), H=Math.round(W*ASPECT)-(Math.round(W*ASPECT)%2);
  const rc=document.createElement("canvas"); rc.width=W; rc.height=H; const rctx=rc.getContext("2d");
  const stream=rc.captureStream(fps);
  let mime="video/webm;codecs=vp9"; if(!MediaRecorder.isTypeSupported(mime))mime="video/webm";
  const mr=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:16000000});
  const chunks=[]; mr.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const done=new Promise(res=>mr.onstop=res);
  mr.start();
  state._base=state.seed;
  const savedP={...P}, savedSeed=state.seed;
  for(let i=0;i<frames;i++){
    const opt=frameParams(i,frames,mode,randomize);
    renderScene(rctx,W,H,{transparent:false,growth:opt.growth});
    setStatus(`recording ${i+1}/${frames}…`);
    await sleep(1000/fps);
  }
  mr.stop(); await done;
  Object.assign(P,savedP); state.seed=savedSeed; state._base=null; SLIDERS.forEach(s=>showVal(s[0])); document.getElementById("seedval").textContent=state.seed;
  const blob=new Blob(chunks,{type:"video/webm"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`INPUT_OUTPUT_sweep_${stamp()}.webm`; a.click(); URL.revokeObjectURL(url);
  setStatus("✔ video .webm downloaded"); scheduleRender();
}

/* ---------- helpers ---------- */
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function stamp(){return new Date().toISOString().replace(/[-:T]/g,"").slice(0,15);}
function clampInt(id,a,b){return Math.max(a,Math.min(b,+document.getElementById(id).value||a));}
function setStatus(t){document.getElementById("status").textContent=t;}
function resetCenter(){ state.center_x=0.5; state.center_y=0.5; scheduleRender(); recordHistory(); }
function resetLimbs(){ limbAims=[]; scheduleRender(); recordHistory(); }

/* ---------- undo / redo ---------- */
let history=[], hidx=-1, suppress=false;
function recordHistory(){
  if(suppress) return;
  const snap=JSON.stringify(snapshot());
  if(history[hidx]===snap) return;
  history=history.slice(0,hidx+1); history.push(snap);
  if(history.length>80) history.shift();
  hidx=history.length-1;
}
function undo(){ if(hidx<=0)return; hidx--; suppress=true; applySnapshot(JSON.parse(history[hidx])); suppress=false; setStatus("undo"); }
function redo(){ if(hidx>=history.length-1)return; hidx++; suppress=true; applySnapshot(JSON.parse(history[hidx])); suppress=false; setStatus("redo"); }

/* ---------- seed gallery (contact sheet) ---------- */
let galBase=8;
function openGallery(){ galBase=state.seed; document.getElementById("gallery").classList.add("open"); renderGallery(); }
function closeGallery(){ document.getElementById("gallery").classList.remove("open"); }
function toggleGallery(){ document.getElementById("gallery").classList.contains("open")?closeGallery():openGallery(); }
function rerollGallery(){ galBase=Math.floor(Math.random()*1e6); renderGallery(); }
function openHelp(){ document.getElementById("help").classList.add("open"); }
function closeHelp(){ document.getElementById("help").classList.remove("open"); }
function renderGallery(){
  const grid=document.getElementById("grid"); grid.innerHTML="";
  const saved=state.seed, TW=380, TH=Math.round(TW*ASPECT);
  for(let i=0;i<12;i++){
    const seed=(galBase+i)>>>0;
    const cell=document.createElement("div"); cell.className="cell";
    const cv=document.createElement("canvas"); cv.width=TW; cv.height=TH;
    state.seed=seed; renderScene(cv.getContext("2d"),TW,TH,{});
    cell.appendChild(cv);
    const cap=document.createElement("div"); cap.className="cap"; cap.textContent="seed "+seed; cell.appendChild(cap);
    cell.onclick=()=>{ state.seed=seed; document.getElementById("seedval").textContent=seed; closeGallery(); scheduleRender(); recordHistory(); };
    grid.appendChild(cell);
  }
  state.seed=saved;
}

/* ---------- breeze (live wind animation) ---------- */
let breezeRAF=null, breezeT=0, breezeBase=null;
function toggleBreeze(on){
  if(on){
    breezeBase={x:P.wind_x,y:P.wind_y}; breezeT=0;
    const step=()=>{
      breezeT+=0.05;
      P.wind_x=breezeBase.x+0.14*Math.sin(breezeT*0.9);
      P.wind_y=breezeBase.y+0.05*Math.sin(breezeT*0.6+1);
      showVal("wind_x"); showVal("wind_y");
      renderScene(cctx,PW,PH,{transparent:!state.white_bg}); drawHandles();
      breezeRAF=requestAnimationFrame(step);
    };
    step();
  } else {
    if(breezeRAF) cancelAnimationFrame(breezeRAF); breezeRAF=null;
    if(breezeBase){ P.wind_x=breezeBase.x; P.wind_y=breezeBase.y; showVal("wind_x"); showVal("wind_y"); breezeBase=null; }
    scheduleRender();
  }
}

/* ---------- keyboard shortcuts ---------- */
function onKey(e){
  const t=document.activeElement; if(t&&/INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
  if(e.ctrlKey||e.metaKey){ if(e.key.toLowerCase()==="z"){ e.preventDefault(); e.shiftKey?redo():undo(); } else if(e.key.toLowerCase()==="y"){ e.preventDefault(); redo(); } return; }
  const k=e.key.toLowerCase();
  if(k==="r") randomizeParams();
  else if(k==="m") mutateParams();
  else if(k==="s") rndSeed();
  else if(k==="c") resetCenter();
  else if(k==="g") toggleGallery();
  else if(k==="escape"){ closeGallery(); closeHelp(); }
  else if(k==="?"||k==="h") openHelp();
}

/* ---------- init ---------- */
function init(){
  buildSliders();
  document.getElementById("seedval").textContent=state.seed;
  bindToggle("round_joints","round_joints");
  bindToggle("soft_tips","soft_tips");
  bindToggle("white_bg","white_bg");
  const em=document.getElementById("edit_mode"); em.checked=state.editMode;
  em.addEventListener("change",()=>setEditMode(em.checked));
  const tm=document.getElementById("tree_mode"); tm.checked=false;
  tm.addEventListener("change",()=>{ state.fork_mode=tm.checked?"tree":"bushy"; scheduleRender(); recordHistory(); });
  document.getElementById("breeze").addEventListener("change",e=>toggleBreeze(e.target.checked));
  document.getElementById("buds").addEventListener("change",e=>{ state.buds=e.target.checked; scheduleRender(); recordHistory(); });
  const asp=document.getElementById("aspect"); asp.addEventListener("change",()=>{ const [w,h]=asp.value.split(",").map(Number); setAspect(w,h); recordHistory(); });
  fitWrap();
  // style buttons
  const sb=document.getElementById("styles");
  Object.keys(STYLES).forEach(n=>{ const b=document.createElement("button"); b.className="chip"; b.textContent=n; b.onclick=()=>applyStyle(n); sb.appendChild(b); });
  setLock("wind_x",true); setLock("wind_y",true);   // wind locked at 0 by default (opt-in; unlock to use wind/Breeze)
  refreshSlots();
  document.getElementById("sliders").addEventListener("change",recordHistory);  // commit param change to history
  window.addEventListener("keydown",onKey);
  window.addEventListener("resize",()=>drawHandles());
  renderDisplay();
  recordHistory();                            // initial state
}
document.addEventListener("DOMContentLoaded",init);

/* expose for inline handlers */
Object.assign(window,{randomizeParams,mutateParams,rndSeed,resetCenter,resetLimbs,clearCenters,savePresetFile,loadPresetFile,saveSlot,loadSlot,delSlot,exportPNG,previewVideo,stopPreview,exportVideo,undo,redo,openGallery,closeGallery,rerollGallery,toggleGallery,setAspect,openHelp,closeHelp,setEditMode});
