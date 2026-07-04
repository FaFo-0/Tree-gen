# INPUT/OUTPUT — branch generator UI (pure algorithm, no AI).
# Run:  python3 app.py     then open  http://localhost:8000
# Stdlib only (needs Pillow, already installed). Sliders -> live preview -> save full-res.
import io, json, os, random, subprocess, tempfile, threading, time, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import branchgen

PORT = 8000
ASPECT = 90.0 / 140.0                      # locked 140:90 print aspect
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# (key, label, min, max, step)  — the sliders shown in the UI
SLIDERS = [
    ("n_main",         "Main limbs",            6,   40,   1),
    ("center_radius",  "Center fill scatter",   0,   180,  1),
    ("center_jitter",  "Center irregularity",   0.0, 1.2,  0.02),
    ("limb_swirl",     "Limb swirl (no log)",   0.0, 0.9,  0.02),
    ("init_width",     "Limb thickness",        6,   48,   1),
    ("init_length",    "Limb length",           80,  600,  10),
    ("wander",         "Wobble",                0.0, 0.25, 0.005),
    ("curl",           "Curl / S-bend",         0.0, 0.15, 0.005),
    ("radial_pull",    "Outward pull",          0.0, 0.06, 0.002),
    ("main_pull",      "Main-limb straightness",0.3, 3.0,  0.1),
    ("taper",          "Taper (1=slow)",        0.965,0.997,0.001),
    ("fork_angle",     "Fork spread",           0.2, 1.1,  0.02),
    ("fork_angle_var", "Fork angle variation",  0.0, 0.6,  0.02),
    ("fork_len_ratio", "Fork length ratio",     0.55,0.92, 0.01),
    ("fork_wid_ratio", "Fork width ratio",      0.55,0.9,  0.01),
    ("fork_asymmetry", "Limb hierarchy (tree)", 0.0, 1.0,  0.02),
    ("third_fork_prob","3-way fork chance",     0.0, 0.6,  0.02),
    ("side_prob",      "Twig density",          0.0, 0.10, 0.002),
    ("twig_floor",     "Twig spawn floor",      1.0, 4.0,  0.1),
    ("side_angle",     "Twig angle",            0.2, 1.4,  0.02),
    ("side_wid_ratio", "Twig thickness",        0.3, 0.8,  0.02),
    ("side_len_ratio", "Twig length",           0.25,0.8,  0.02),
    ("max_depth",      "Recursion depth",       6,   16,   1),
    ("min_width",      "Finest twig",           0.4, 2.0,  0.05),
    ("step_px",        "Smoothness (low=fine)", 2.0, 8.0,  0.5),
    ("blur",           "Softness",              0.0, 1.6,  0.1),
]
INT_KEYS = {"n_main", "max_depth"}

def build_params(q, preview_w):
    p = dict(branchgen.DEFAULTS)
    for key, *_ in SLIDERS:
        if key in q:
            v = float(q[key][0])
            p[key] = int(round(v)) if key in INT_KEYS else v
    p["seed"] = int(float(q.get("seed", ["8"])[0]))
    p["center_x"] = min(1.0, max(0.0, float(q.get("center_x", ["0.5"])[0])))
    p["center_y"] = min(1.0, max(0.0, float(q.get("center_y", ["0.5"])[0])))
    p["soft_tips"] = q.get("soft_tips", ["0"])[0] in ("1", "true", "on")
    p["round_joints"] = q.get("round_joints", ["1"])[0] in ("1", "true", "on")
    p["fork_mode"] = "tree" if q.get("tree_mode", ["0"])[0] in ("1", "true", "on") else "bushy"
    p["W"] = int(preview_w)
    p["H"] = int(round(preview_w * ASPECT))
    return p

def render_png(p, white_bg=True):
    g = branchgen.render(p)
    if not white_bg:
        g = branchgen.to_transparent(g)          # black branches on transparent
    buf = io.BytesIO(); g.save(buf, "PNG"); return buf.getvalue()

def render_video(q):
    # Seed-sweep: one frame per seed (base, base+1, …). Optionally randomize the UNLOCKED
    # slider params on every frame; locked params keep their current value.
    # Returns (content_type, extension, bytes). Tries MP4 via ffmpeg, falls back to GIF.
    frames = max(2, min(600, int(float(q.get("frames", ["60"])[0]))))
    fps    = max(1, min(60, int(float(q.get("fps", ["12"])[0]))))
    vw     = max(200, min(4000, int(float(q.get("vw", ["1000"])[0]))))
    vw -= vw % 2
    vh = int(round(vw * ASPECT)); vh -= vh % 2
    randomize = q.get("randomize", ["0"])[0] in ("1", "true", "on")
    locked = set(x for x in q.get("locked", [""])[0].split(",") if x)
    base_seed = int(float(q.get("seed", ["8"])[0]))
    base_p = build_params(q, vw); base_p["H"] = vh

    imgs = []
    for i in range(frames):
        p = dict(base_p); p["seed"] = base_seed + i
        if randomize:
            for key, label, mn, mx, st in SLIDERS:
                if key in locked:
                    continue
                steps = int(round((mx - mn) / st))
                v = mn + st * random.randint(0, steps)
                p[key] = int(round(v)) if key in INT_KEYS else v
        imgs.append(branchgen.render(p))          # 'L' frames

    mp4 = _encode_mp4(imgs, fps)
    if mp4 is not None:
        return ("video/mp4", "mp4", mp4)
    return ("image/gif", "gif", _encode_gif(imgs, fps))

def _encode_mp4(imgs, fps):
    fd, mp4 = tempfile.mkstemp(suffix=".mp4"); os.close(fd)
    fe, elog = tempfile.mkstemp(suffix=".log")
    try:
        proc = subprocess.Popen(
            ["ffmpeg", "-y", "-f", "image2pipe", "-framerate", str(fps), "-i", "-",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
             "-movflags", "+faststart", mp4],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=fe)
        for im in imgs:
            im.save(proc.stdin, "PNG")
        proc.stdin.close(); proc.wait()
        ok = proc.returncode == 0
    except Exception:
        ok = False
    finally:
        try: os.close(fe)
        except OSError: pass
    if ok:
        data = open(mp4, "rb").read()
    else:
        data = None
    for f in (mp4, elog):
        try: os.remove(f)
        except OSError: pass
    return data

def _encode_gif(imgs, fps):
    frames = [im.convert("P") for im in imgs]
    buf = io.BytesIO()
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:],
                   duration=max(20, int(round(1000.0/fps))), loop=0, optimize=True)
    return buf.getvalue()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == "/":
            self._send(200, "text/html; charset=utf-8", PAGE.encode())
        elif u.path == "/generate":
            p = build_params(q, int(float(q.get("pw", ["1400"])[0])))
            white_bg = q.get("white_bg", ["1"])[0] in ("1", "true", "on")
            self._send(200, "image/png", render_png(p, white_bg))
        elif u.path == "/download":
            # render at full res and stream as a browser download (attachment).
            fw = int(float(q.get("fw", ["8400"])[0]))
            p = build_params(q, fw)
            white = q.get("which", ["white"])[0] != "transparent"
            png = render_png(p, white)
            ts = time.strftime("%Y%m%d_%H%M%S")
            sfx = "" if white else "_transparent"
            fname = "INPUT_OUTPUT_branches_seed%d_%s%s.png" % (p["seed"], ts, sfx)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % fname)
            self.send_header("Content-Length", str(len(png)))
            self.end_headers()
            self.wfile.write(png)
        elif u.path == "/video":
            try:
                ctype, ext, data = render_video(q)
            except Exception as e:
                self._send(500, "text/plain", ("video error: %s" % e).encode())
                return
            ts = time.strftime("%Y%m%d_%H%M%S")
            fname = "INPUT_OUTPUT_seedsweep_%s.%s" % (ts, ext)
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % fname)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self._send(404, "text/plain", b"not found")

PAGE = """<!doctype html><html><head><meta charset=utf-8>
<title>INPUT/OUTPUT branch generator</title>
<style>
 body{margin:0;background:#111;color:#ddd;font:13px/1.4 -apple-system,Segoe UI,sans-serif;display:flex;height:100vh}
 #panel{width:320px;padding:14px 16px;overflow-y:auto;background:#191919;border-right:1px solid #2a2a2a}
 #stage{flex:1;display:flex;align-items:center;justify-content:center;background:#0c0c0c;position:relative}
 #stage img{max-width:96%;max-height:96%;box-shadow:0 6px 40px #000;cursor:crosshair;
   background:conic-gradient(#bbb 90deg,#fff 0 180deg,#bbb 0 270deg,#fff 0) 0 0/26px 26px}
 h1{font-size:14px;margin:0 0 10px;letter-spacing:.5px;color:#fff}
 .row{margin:9px 0}
 .row label{display:flex;justify-content:space-between;color:#bbb;margin-bottom:3px}
 .row label b{color:#6cf;font-weight:600}
 input[type=range]{width:100%}
 .btns{display:flex;gap:8px;margin:12px 0}
 button{flex:1;padding:9px;border:0;border-radius:6px;background:#2a6cf0;color:#fff;font-weight:600;cursor:pointer}
 button.alt{background:#333}
 button:active{transform:translateY(1px)}
 .seedrow{display:flex;gap:8px;align-items:center;margin:8px 0}
 .seedrow input{width:80px;background:#222;color:#fff;border:1px solid #333;border-radius:5px;padding:5px}
 #status{position:absolute;bottom:10px;left:12px;color:#888;font-size:12px}
 #spin{position:absolute;top:12px;right:14px;color:#6cf;display:none}
 .chk{display:flex;align-items:center;gap:8px;margin:8px 0;color:#bbb}
 .lk{cursor:pointer;margin-right:6px;user-select:none;font-size:12px;opacity:.5;filter:grayscale(1)}
 .lk.on{opacity:1;filter:none}
 .row label span{display:inline-flex;align-items:center}
 .vrow{display:flex;gap:8px;margin:8px 0}
 .vrow label{flex:1;display:flex;flex-direction:column;color:#bbb;font-size:12px;gap:3px}
 .vrow input{background:#222;color:#fff;border:1px solid #333;border-radius:5px;padding:5px;width:100%;box-sizing:border-box}
 small{color:#666}
</style></head><body>
<div id=panel>
 <h1>INPUT / OUTPUT — BRANCHES</h1>
 <div class=seedrow>
   <span>Seed</span><input id=seed type=number value=8>
   <button class=alt style=flex:0 onclick="rndSeed()">random</button>
 </div>
 <div class=btns>
   <button class=alt onclick="resetCenter()">✛ Reset center</button>
   <span style="flex:2;color:#888;font-size:11px;align-self:center">click the preview to move the center</span>
 </div>
 <div class=chk><input type=checkbox id=white_bg checked><label for=white_bg>White background (off = transparent, shows QR overlay checker)</label></div>
 <div class=chk><input type=checkbox id=tree_mode><label for=tree_mode>Tree forks (monopodial) — off = Bushy (denser)</label></div>
 <div class=chk><input type=checkbox id=round_joints checked><label for=round_joints>Round joints (smooth limbs, no faceted notches)</label></div>
 <div class=btns>
   <button onclick="randomizeParams()">🎲 Randomize parameters</button>
 </div>
 <div class=btns>
   <button class=alt onclick="savePreset()">💾 Save preset</button>
   <button class=alt onclick="document.getElementById('presetfile').click()">📂 Load preset</button>
   <input type=file id=presetfile accept=".json" style=display:none onchange="loadPreset(this.files[0]);this.value=''">
 </div>
 <div id=sliders></div>
 <div class=chk><input type=checkbox id=soft_tips><label for=soft_tips>Soft gray tips (dither with QR)</label></div>
 <div class=btns>
   <button onclick="gen()">Generate preview</button>
 </div>
 <div class=btns>
   <button class=alt onclick="dl('white')">⬇ Download white</button>
   <button class=alt onclick="dl('transparent')">⬇ Download transparent</button>
 </div>
 <small>Downloads full 8400×5400 PNG to your browser's Downloads folder. Each file is uniquely named (seed + timestamp) — never overwrites. 140:90 aspect locked.</small>
 <hr style="border:0;border-top:1px solid #2a2a2a;margin:14px 0">
 <b style="color:#fff">🎬 Seed-sweep video</b>
 <div class=vrow>
   <label>Frames <input id=vframes type=number value=60 min=2 max=600></label>
   <label>FPS <input id=vfps type=number value=12 min=1 max=60></label>
   <label title="pixel width of each video frame (height auto from 140:90). Bigger = sharper but slower.">Width <input id=vw type=number value=1000 min=200 max=4000 step=2></label>
 </div>
 <div class=chk><input type=checkbox id=vrand><label for=vrand>Randomize params each frame (respects 🔒 locks)</label></div>
 <div class=btns>
   <button onclick="previewVideo()">▶ Preview</button>
   <button class=alt onclick="stopPreview()">■ Stop</button>
 </div>
 <div class=btns><button onclick="exportVideo()">🎬 Export MP4</button></div>
 <small>One frame per seed (from Seed upward). <b>Width</b> = frame pixel width (height auto, 140:90); bigger = sharper but slower — separate from the 8400px still. Preview plays in-browser; Export downloads MP4 (or GIF if ffmpeg is unavailable).</small>
</div>
<div id=stage>
  <img id=out src="">
  <div id=spin>rendering…</div>
  <div id=status></div>
</div>
<script>
const SLIDERS=__SLIDERS__;
const panel=document.getElementById('sliders');
const locked=new Set();
let centerX=0.5, centerY=0.5;             // convergence point (fractions), set by clicking the preview
function decimals(st){const p=String(st).split('.')[1];return p?p.length:0;}
window.toggleLock=(key)=>{
  const el=document.getElementById('lk_'+key);
  if(locked.has(key)){locked.delete(key);el.textContent='🔓';el.classList.remove('on');}
  else{locked.add(key);el.textContent='🔒';el.classList.add('on');}
};
SLIDERS.forEach((s,i)=>{
  const[key,label,mn,mx,st,val]=s;
  const hue=Math.round(i*360/SLIDERS.length);          // each slider a distinct color
  const col='hsl('+hue+',75%,60%)';
  const dec=decimals(st);
  const d=document.createElement('div');d.className='row';
  d.innerHTML=`<label style="color:${col}"><span><span class=lk id="lk_${key}" title="lock from Randomize" onclick="toggleLock('${key}')">🔓</span>${label}</span> <b id="v_${key}" style="color:${col}"></b></label>
    <input type=range id="${key}" min=${mn} max=${mx} step=${st} value=${val}>`;
  panel.appendChild(d);
  const inp=document.getElementById(key);                // the RANGE (not the lock icon)
  inp.style.accentColor=col;
  const show=()=>document.getElementById('v_'+key).textContent=(+inp.value).toFixed(dec);
  inp.addEventListener('input',show);inp.addEventListener('change',gen);show();
});
document.getElementById('seed').addEventListener('change',gen);
document.getElementById('soft_tips').addEventListener('change',gen);
document.getElementById('tree_mode').addEventListener('change',gen);
document.getElementById('white_bg').addEventListener('change',gen);
document.getElementById('round_joints').addEventListener('change',gen);
document.getElementById('out').addEventListener('click',e=>{
  const r=e.target.getBoundingClientRect();
  centerX=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));
  centerY=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));
  gen();
});
function q(){
  const p=new URLSearchParams();
  SLIDERS.forEach(s=>p.set(s[0],document.getElementById(s[0]).value));
  p.set('seed',document.getElementById('seed').value);
  p.set('soft_tips',document.getElementById('soft_tips').checked?'1':'0');
  p.set('round_joints',document.getElementById('round_joints').checked?'1':'0');
  p.set('tree_mode',document.getElementById('tree_mode').checked?'1':'0');
  p.set('white_bg',document.getElementById('white_bg').checked?'1':'0');
  p.set('center_x',centerX);p.set('center_y',centerY);
  return p;
}
function resetCenter(){centerX=0.5;centerY=0.5;gen();}
function rndSeed(){document.getElementById('seed').value=Math.floor(Math.random()*100000);gen();}
function randomizeParams(){
  SLIDERS.forEach(s=>{
    const[key,label,mn,mx,st]=s;
    if(locked.has(key)) return;                          // locked -> keep current value
    const steps=Math.round((mx-mn)/st);
    const v=mn+st*Math.floor(Math.random()*(steps+1));
    const inp=document.getElementById(key);
    inp.value=v; document.getElementById('v_'+key).textContent=(+inp.value).toFixed(decimals(st));
  });
  gen();
}
// ---- helpers ----
function el(id){return document.getElementById(id);}
function status(t){el('status').textContent=t;}
function setChk(id,v){if(el(id))el(id).checked=!!v;}
function showVal(key,st){el('v_'+key).textContent=(+el(key).value).toFixed(decimals(st));}
function setLock(key,on){const e=el('lk_'+key);if(!e)return;if(on){locked.add(key);e.textContent='🔒';e.classList.add('on');}else{locked.delete(key);e.textContent='🔓';e.classList.remove('on');}}
// ---- presets (portable JSON) ----
function savePreset(){
  const o={params:{},seed:el('seed').value,locked:[...locked],center:{x:centerX,y:centerY},
    toggles:{white_bg:el('white_bg').checked,tree_mode:el('tree_mode').checked,round_joints:el('round_joints').checked,soft_tips:el('soft_tips').checked},
    video:{frames:el('vframes').value,fps:el('vfps').value,vw:el('vw').value,randomize:el('vrand').checked}};
  SLIDERS.forEach(s=>o.params[s[0]]=el(s[0]).value);
  const blob=new Blob([JSON.stringify(o,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const ts=new Date().toISOString().replace(/[-:T]/g,'').slice(0,15);
  const a=document.createElement('a');a.href=url;a.download='INPUT_OUTPUT_preset_'+ts+'.json';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);status('✔ saved preset');
}
function loadPreset(file){
  if(!file)return;const r=new FileReader();
  r.onload=()=>{try{applyPreset(JSON.parse(r.result));}catch(e){status('bad preset: '+e);}};
  r.readAsText(file);
}
function applyPreset(o){
  if(o.params)SLIDERS.forEach(s=>{const k=s[0];if(o.params[k]!=null){el(k).value=o.params[k];showVal(k,s[4]);}});
  if(o.seed!=null)el('seed').value=o.seed;
  if(o.center){centerX=o.center.x;centerY=o.center.y;}
  if(o.toggles){setChk('white_bg',o.toggles.white_bg);setChk('tree_mode',o.toggles.tree_mode);setChk('round_joints',o.toggles.round_joints);setChk('soft_tips',o.toggles.soft_tips);}
  const lk=new Set(o.locked||[]);SLIDERS.forEach(s=>setLock(s[0],lk.has(s[0])));
  if(o.video){setChk('vrand',o.video.randomize);if(o.video.frames)el('vframes').value=o.video.frames;if(o.video.fps)el('vfps').value=o.video.fps;if(o.video.vw)el('vw').value=o.video.vw;}
  gen();status('✔ loaded preset');
}
// ---- video preview (plays frames in-browser) ----
let previewTimer=null, previewImgs=[];
function frameQuery(i){
  const p=q();
  p.set('seed',(+el('seed').value)+i);
  p.set('pw',Math.min(+el('vw').value,800));
  if(el('vrand').checked){
    SLIDERS.forEach(s=>{const[key,label,mn,mx,st]=s;if(locked.has(key))return;
      const steps=Math.round((mx-mn)/st);const v=mn+st*Math.floor(Math.random()*(steps+1));
      p.set(key,(+v).toFixed(decimals(st)));});
  }
  return p.toString();
}
function loadImg(src){return new Promise(r=>{const im=new Image();im.onload=()=>r(im);im.onerror=()=>r(im);im.src=src;});}
async function previewVideo(){
  stopPreview();
  const frames=Math.max(2,Math.min(600,+el('vframes').value));
  const fps=Math.max(1,Math.min(60,+el('vfps').value));
  el('spin').style.display='block';previewImgs=[];
  for(let i=0;i<frames;i++){
    status('buffering preview '+(i+1)+'/'+frames+'…');
    previewImgs.push(await loadImg('/generate?'+frameQuery(i)+'&_='+Date.now()+i));
  }
  el('spin').style.display='none';
  let k=0;status('▶ playing preview ('+frames+' frames) — press Stop to end');
  previewTimer=setInterval(()=>{el('out').src=previewImgs[k%frames].src;k++;},Math.round(1000/fps));
}
function stopPreview(){if(previewTimer){clearInterval(previewTimer);previewTimer=null;status('preview stopped');}}
let t0;
function gen(){
  if(typeof stopPreview==='function')stopPreview();
  const p=q();p.set('pw','1400');
  document.getElementById('spin').style.display='block';
  t0=performance.now();
  const img=new Image();
  img.onload=()=>{document.getElementById('out').src=img.src;
    document.getElementById('spin').style.display='none';
    document.getElementById('status').textContent='preview '+Math.round(performance.now()-t0)+' ms';};
  img.src='/generate?'+p.toString()+'&_='+Date.now();
}
function exportVideo(){
  const p=q();
  p.set('frames',document.getElementById('vframes').value);
  p.set('fps',document.getElementById('vfps').value);
  p.set('vw',document.getElementById('vw').value);
  p.set('randomize',document.getElementById('vrand').checked?'1':'0');
  p.set('locked',[...locked].join(','));
  document.getElementById('spin').style.display='block';
  document.getElementById('status').textContent='rendering '+document.getElementById('vframes').value+' frames → MP4… (this can take a while)';
  fetch('/video?'+p.toString()).then(r=>{if(!r.ok)return r.text().then(t=>{throw new Error(t)});return r.blob();}).then(b=>{
    const url=URL.createObjectURL(b);
    const ts=new Date().toISOString().replace(/[-:T]/g,'').slice(0,15);
    const ext=b.type.indexOf('gif')>=0?'gif':'mp4';
    const name='INPUT_OUTPUT_seedsweep_'+ts+'.'+ext;
    const a=document.createElement('a');a.href=url;a.download=name;
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    document.getElementById('spin').style.display='none';
    document.getElementById('status').textContent='✔ '+(ext==='gif'?'GIF (ffmpeg unavailable) ':'video ')+name;
  }).catch(e=>{
    document.getElementById('spin').style.display='none';
    document.getElementById('status').textContent='VIDEO FAILED: '+e;
  });
}
function dl(which){
  const p=q();p.set('fw','8400');p.set('which',which);
  document.getElementById('spin').style.display='block';
  document.getElementById('status').textContent='rendering full 8400×5400 '+which+'…';
  fetch('/download?'+p.toString()).then(r=>r.blob()).then(b=>{
    const url=URL.createObjectURL(b);
    const ts=new Date().toISOString().replace(/[-:T]/g,'').slice(0,15);
    const sfx=which==='transparent'?'_transparent':'';
    const name='INPUT_OUTPUT_branches_seed'+document.getElementById('seed').value+'_'+ts+sfx+'.png';
    const a=document.createElement('a');a.href=url;a.download=name;
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    document.getElementById('spin').style.display='none';
    document.getElementById('status').textContent='✔ downloaded '+name;
  }).catch(e=>{
    document.getElementById('spin').style.display='none';
    document.getElementById('status').textContent='DOWNLOAD FAILED: '+e;
  });
}
gen();
</script></body></html>"""

def _inject():
    rows = []
    for key, label, mn, mx, st in SLIDERS:
        rows.append([key, label, mn, mx, st, branchgen.DEFAULTS[key]])
    return PAGE.replace("__SLIDERS__", json.dumps(rows)).replace("__OUTDIR__", OUT_DIR)

PAGE = _inject()

if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    url = "http://localhost:%d" % PORT
    print("INPUT/OUTPUT branch generator running at", url)
    print("Ctrl-C to stop.")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
