# INPUT/OUTPUT — procedural branch generator (no AI, no dataset; pure algorithm)
# Recursive bifurcating bare-tree canopy, radiating from a dark central knot.
# Matches: solid black on white, thick converging center, repeated Y-forks,
# sinuous curling limbs that cross/overlap, tapering to fine twigs at the edges.
import math, random
from PIL import Image, ImageDraw, ImageFilter

DEFAULTS = dict(
    seed=8,
    W=2000, H=1286,          # preview res; aspect locked ~1.556 (140:90). Full = 8400x5400.
    center_x=0.5, center_y=0.5,   # convergence point as fractions of W,H (0.5,0.5 = middle; 0,0 = top-left corner)
    fork_mode="bushy",       # "bushy" = symmetric Y-forks (denser, branchier — the earlier method)
                             # "tree"  = asymmetric monopodial (bold limb + thin side branch)
    n_main=9,                # main limbs out of the center — a root system, few bold limbs
    center_radius=16.0,      # scatter radius of limb starts (fills dark core; 0 = pinpoint)
    center_jitter=0.35,      # angular irregularity (breaks exact opposite-pair "log" alignment)
    init_width=32.0,         # base width of a main limb (bigger = thicker limbs)
    init_length=150.0,       # short = limbs fork quickly after leaving the center
    wander=0.03,             # per-step angle jitter (organic wobble)
    curl=0.02,               # per-branch consistent bend (lower = straighter)
    radial_pull=0.026,       # outward bias — keeps branches flowing out, no inward loops
    taper=0.993,             # slow taper: limbs retain thickness while branching (gentle hierarchy)
    fork_angle=0.52,         # branch-off angle at a fork
    fork_angle_var=0.28,     # randomness added to fork angle
    fork_len_ratio=0.80,     # child length / parent length
    fork_wid_ratio=0.82,     # high = branches keep thickness after forking (retain-thickness look)
    fork_asymmetry=0.55,     # (tree mode) 0 = even split; 1 = one dominant axis + thin side branch
    third_fork_prob=0.22,    # chance a fork throws a 3rd child
    side_prob=0.060,         # per-step chance of a micro/hair side branch (fills all gaps)
    side_angle=0.7,          # side-twig branch-off angle
    side_wid_ratio=0.42,     # thin hair twigs
    side_len_ratio=0.35,     # short hair twigs (micro branches everywhere, not long wisps)
    max_depth=14,            # recursion depth cap
    min_width=1.10,          # stop when thinner than this (higher = no hairlines, thicker twigs)
    limb_swirl=0.35,         # off-radial start of main limbs (breaks straight "log" through center)
    twig_floor=1.3,          # hairs spawn while wid > this * min_width (lower = hairs on finer branches)
    main_pull=1.5,           # outward-pull strength on main limbs (higher = straighter radial)
    step_px=4.0,             # segment length (lower = smoother curves, slower)
    round_joints=True,       # round the joints (smooth limbs, no faceted notches)
    soft_tips=False,         # True = fade thinnest tips to gray (dithers with QR modules)
    blur=0.8,                # anti-alias softening (px, pre-scale)
    cap=1500000,             # global segment budget (safety)
)

def _reach(cx, cy, angle, W, H):
    # distance from center to the frame edge along `angle` (corner limbs get more budget)
    dx, dy = math.cos(angle), math.sin(angle)
    ts = []
    if dx > 1e-9: ts.append((W-cx)/dx)
    elif dx < -1e-9: ts.append((0-cx)/dx)
    if dy > 1e-9: ts.append((H-cy)/dy)
    elif dy < -1e-9: ts.append((0-cy)/dy)
    return min(t for t in ts if t > 0)

def render(params=None, **kw):
    p = dict(DEFAULTS);
    if params: p.update(params)
    p.update(kw)
    W, H = int(p["W"]), int(p["H"])
    random.seed(p["seed"])
    sc = W / 2000.0
    img = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(img)
    cx, cy = W*p["center_x"], H*p["center_y"]      # convergence point (fractions 0..1)
    step = p["step_px"] * sc
    minw = p["min_width"] * sc
    steps = [0]
    cap = p["cap"]

    # branch record: (x, y, ang, wid, length, depth, is_main)
    stack = []
    n = int(p["n_main"])
    diag = math.hypot(W, H)
    for i in range(n):
        a = (2*math.pi*i/n) + random.uniform(-p["center_jitter"], p["center_jitter"])
        reach = _reach(cx, cy, a, W, H)
        # if the center is off-center and this limb points out of the frame (tiny reach),
        # re-aim it at a random interior point so corner/edge centers still fill the frame.
        if reach < 0.10 * diag:
            tx = random.uniform(0.05, 0.95) * W; ty = random.uniform(0.05, 0.95) * H
            a = math.atan2(ty - cy, tx - cx)
            reach = _reach(cx, cy, a, W, H)
        # scatter each limb's START inside a disc (not on a ring), direction still outward,
        # so bases overlap and fill the core. radius 0 = all start dead center = solid knot.
        rr = p["center_radius"] * sc * math.sqrt(random.random())
        sa = random.uniform(0, 2*math.pi)
        sx, sy = cx + math.cos(sa)*rr, cy + math.sin(sa)*rr
        # length scaled so the recursive geometric sum of forks covers the reach
        L = max(p["init_length"]*sc, reach * (1 - p["fork_len_ratio"]) * random.uniform(1.0, 1.3))
        ang0 = a + random.uniform(-p["limb_swirl"], p["limb_swirl"])   # off-radial start (no straight "log")
        stack.append((sx, sy, ang0,
                      random.uniform(0.85, 1.0)*p["init_width"]*sc, L, 0, True))

    while stack and steps[0] < cap:
        x, y, ang, wid, length, depth, is_main = stack.pop()
        if depth > p["max_depth"] or wid < minw:
            continue
        curl = random.gauss(0, p["curl"])                 # this branch's bend
        life = length
        w0 = wid
        seglen = length
        while life > 0 and wid > minw and steps[0] < cap:
            # organic direction update
            ang += curl + random.gauss(0, p["wander"])
            # outward bias on every branch (strong on main limbs, gentle on twigs) so
            # limbs radiate and cross without curling back into the center
            desired = math.atan2(y-cy, x-cx)
            diff = (desired-ang+math.pi) % (2*math.pi) - math.pi
            ang += p["radial_pull"] * diff * (p["main_pull"] if is_main else 0.5)
            nx = x + math.cos(ang)*step
            ny = y + math.sin(ang)*step
            col = 0
            if p["soft_tips"] and wid < 1.8*sc:
                col = int(75*(1 - wid/(1.8*sc)))
            w = max(1, int(round(wid)))
            d.line([x, y, nx, ny], fill=col, width=w)
            if p["round_joints"] and w >= 3:            # round the joint so limbs stay smooth:
                r = w / 2.0                             # no faceted notches or hairline cracks at bends
                d.ellipse([nx-r, ny-r, nx+r, ny+r], fill=col)
            x, y = nx, ny
            wid *= p["taper"]; life -= step; steps[0] += 1
            # mid-branch side twig — only when thick enough to grow a real twig. spawning near
            # the min width produced thorn-like 1-segment spikes all over the limbs.
            if random.random() < p["side_prob"] and wid > p["twig_floor"]*minw:
                sa = ang + random.choice([-1, 1]) * (p["side_angle"] + random.uniform(-0.25, 0.25))
                stack.append((x, y, sa, wid*p["side_wid_ratio"],
                              seglen*p["side_len_ratio"], depth+2, False))
        # terminal fork — two styles:
        if depth < p["max_depth"] and wid > minw:
            sp = p["fork_angle"] + random.uniform(0, p["fork_angle_var"])
            base_len = seglen * p["fork_len_ratio"]
            ew = wid                                    # ended (already-tapered) width
            if p["fork_mode"] == "bushy":
                # symmetric Y-fork: two near-equal children (denser, branchier). Both keep
                # is_main so the whole crown stays radial and fills. This is the earlier method.
                cw = ew * p["fork_wid_ratio"]
                cl = base_len * random.uniform(0.85, 1.1)
                for s in (-1, 1):
                    stack.append((x, y, ang + s*sp*random.uniform(0.7, 1.2),
                                  cw*random.uniform(0.85, 1.05), cl, depth+1, is_main))
                if random.random() < p["third_fork_prob"]:
                    stack.append((x, y, ang + random.uniform(-0.3, 0.3),
                                  cw*0.85, cl*0.85, depth+1, False))
            else:
                # asymmetric monopodial: one dominant axis continues (bold limb), one thin
                # side branch. asym=0 -> near-even; asym=1 -> strong bold/fine hierarchy.
                asym = p["fork_asymmetry"]
                side = random.choice([-1, 1])
                dom_w = ew * (0.98 - 0.06 * (1 - asym))
                dom_ang = ang - side * sp * (0.30 * (1 - asym))
                dom_len = base_len * random.uniform(0.9, 1.05)
                stack.append((x, y, dom_ang, dom_w, dom_len, depth+1, is_main))
                min_w = ew * (0.82 - 0.34 * asym)
                min_ang = ang + side * sp * (1 + 0.4 * asym)
                min_len = base_len * (1 - 0.30 * asym) * random.uniform(0.85, 1.05)
                stack.append((x, y, min_ang, min_w*random.uniform(0.9, 1.05), min_len, depth+1, False))
                if random.random() < p["third_fork_prob"]:
                    stack.append((x, y, ang + random.choice([-1, 1]) * sp * 0.6,
                                  min_w*0.8, min_len*0.85, depth+1, False))

    if p["blur"] > 0:
        img = img.filter(ImageFilter.GaussianBlur(max(0.4, p["blur"]*sc)))
    return img

def to_transparent(gray):
    return Image.merge("RGBA", (Image.new("L", gray.size, 0),)*3 + (gray.point(lambda v: 255-v),))

if __name__ == "__main__":
    import sys
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    g = render(seed=seed)
    g.save("preview_seed%d.png" % seed)
    print("done", g.size)
