"""SDXL prompt list.
kind: 'texture' (seamless tile, painterly; pixelated later), 'sprite' (single object on a flat key color), 'art' (full scene).
bg: background color word used for keying ('white' or 'black').
"""

SPRITE_STYLE = "pixel art game sprite, clean dark outline, bold simple shapes, vibrant colors, single object only"
TEX_STYLE = "stylized hand painted game texture, simple, soft, low detail, natural colors"
ART_STYLE = "16-bit pixel art, retro video game, vibrant colors"

ISO = "isometric 3/4 view"
TOP = "top-down view directly from above"


def tex(p, seeds=3, **kw):
    return dict(kind="texture", style=TEX_STYLE, seeds=seeds,
                prompt=f"seamless top-down {p} ground texture, flat even lighting, uniform, fills the whole frame",
                neg="objects, cars, buildings, people, perspective, horizon, shapes, tiles, bricks, grid, pattern of icons, frame, vignette",
                **kw)


def spr(p, view=ISO, seeds=4, bg="white", **kw):
    return dict(kind="sprite", style=SPRITE_STYLE, seeds=seeds, bg=bg,
                prompt=f"one single {p}, {view}, centered with empty space around it, isolated on a plain solid {bg} background",
                neg="multiple objects, many, sprite sheet, pattern, repeated, tiles, collage, scenery, ground, floor, platform, base, background details, cropped, shadow",
                **kw)


JOBS = {
    # --- ground textures ---
    "tex_grass": tex("lush short green lawn grass"),
    "tex_dirt": tex("smooth packed light brown dirt"),
    "tex_asphalt": tex("plain smooth dark grey asphalt"),
    "tex_sand": tex("smooth golden beach sand with gentle ripples"),
    "tex_water": tex("calm blue ocean water surface with gentle ripples"),
    "tex_snow": tex("smooth fresh white snow with soft blue shading"),
    "tex_ice": tex("smooth pale blue frozen ice with faint white scratches"),
    "tex_concrete": tex("plain light grey concrete"),
    "tex_rubber": tex("dark grey diamond plate steel floor"),

    # --- cars (top-down, pointing up; recolored in processing) ---
    "car_buggy": spr("red rc buggy race car pointing straight up, four big black wheels, roll cage", view=TOP, seeds=8),
    "car_formula": spr("red rc formula race car pointing straight up, front and rear wing, black slick tires", view=TOP, seeds=8),

    # --- flat decals (top-down, projected onto the ground) ---
    "oil": spr("black glossy oil spill stain", view=TOP, seeds=6),
    "puddle": spr("shallow blue water puddle", view=TOP, seeds=6),
    "missile": spr("small red rocket missile with fins pointing straight up", view=TOP),

    # --- upright props (iso sprites) ---
    "tree_oak": spr("round leafy green oak tree", seeds=6),
    "bush": spr("small round green bush with pink flowers", seeds=6),
    "haybale": spr("round golden hay bale"),
    "tree_palm": spr("tropical palm tree", seeds=6),
    "rock": spr("grey boulder rock"),
    "umbrella": spr("red and white striped beach umbrella"),
    "tree_pine": spr("snowy green pine tree", bg="black", seeds=6),
    "snowman": spr("cute snowman with red scarf and top hat", bg="black"),
    "cone": spr("orange traffic cone"),
    "barrel": spr("red oil drum barrel"),
    "tirestack": spr("stack of three black car tires"),
    "lamp": spr("tall industrial street lamp post"),
    "cloud": spr("dark grey storm rain cloud with falling blue raindrops", view="side view", seeds=4),
    "bomb": spr("round black cartoon bomb with lit fuse"),
    "icon_engine": spr("shiny chrome car engine", seeds=4),
    "icon_tire": spr("racing tire", view="front view", seeds=4),
    "icon_battery": spr("car battery with lightning bolt symbol", seeds=4),
    "trophy": spr("shiny gold trophy cup", view="front view", seeds=3),

    # --- screens ---
    "title_art": dict(kind="art", style=ART_STYLE, w=1344, h=768, seeds=6,
                      prompt="video game title screen illustration, three small colorful rc race cars jumping off a dirt ramp on a winding race track in a sunny backyard, dramatic low angle, dust clouds, blue sky",
                      neg="text, letters, words, logo, people, ui"),
}
