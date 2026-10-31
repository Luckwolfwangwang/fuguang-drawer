from PIL import Image, ImageDraw, ImageFilter
import math

S = 1024
SS = 2
W = S * SS
img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# ---- background squircle with a deep, luminous gradient ----
bg = Image.new("RGBA", (W, W), (0, 0, 0, 0))
bd = ImageDraw.Draw(bg)
for y in range(W):
    t = y / (W - 1)
    r = int(29 + 25 * t)
    g = int(34 + 40 * t)
    b = int(68 + 105 * t)
    bd.line([(0, y), (W, y)], fill=(r, g, b, 255))

# radial warm glow upper-right
glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([W * 0.48, -W * 0.22, W * 1.25, W * 0.55], fill=(126, 214, 255, 110))
glow = glow.filter(ImageFilter.GaussianBlur(120 * SS))
bg = Image.alpha_composite(bg, glow)

# teal glow lower-left
glow2 = Image.new("RGBA", (W, W), (0, 0, 0, 0))
gd2 = ImageDraw.Draw(glow2)
gd2.ellipse([-W * 0.3, W * 0.55, W * 0.55, W * 1.25], fill=(70, 255, 208, 80))
glow2 = glow2.filter(ImageFilter.GaussianBlur(130 * SS))
bg = Image.alpha_composite(bg, glow2)

# squircle mask
mask = Image.new("L", (W, W), 0)
md = ImageDraw.Draw(mask)
pad = int(W * 0.06)
radius = int(W * 0.30)
md.rounded_rectangle([pad, pad, W - pad, W - pad], radius=radius, fill=255)
img = Image.alpha_composite(img, bg)
img.putalpha(mask)

# ---- inner glass slab ----
slab = Image.new("RGBA", (W, W), (0, 0, 0, 0))
sd = ImageDraw.Draw(slab)
m = int(W * 0.155)
slab_box = [m, int(W * 0.20), W - m, int(W * 0.80)]
sd.rounded_rectangle(slab_box, radius=int(W * 0.19), fill=(255, 255, 255, 42))
# glass edge
sd.rounded_rectangle(slab_box, radius=int(W * 0.19), outline=(255, 255, 255, 140), width=int(W * 0.008))
# top inner highlight
sd.rounded_rectangle([slab_box[0] + 8 * SS, slab_box[1] + 8 * SS, slab_box[2] - 8 * SS, slab_box[3] - 8 * SS],
                     radius=int(W * 0.185), outline=(255, 255, 255, 55), width=int(W * 0.004))
img = Image.alpha_composite(img, slab)

# ---- drawer lines ----
lines = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ld = ImageDraw.Draw(lines)
cx = W / 2
width = int(W * 0.33)
for i, y in enumerate([0.345, 0.455, 0.565]):
    yy = int(W * y)
    h = int(W * 0.052)
    ld.rounded_rectangle([cx - width / 2, yy - h / 2, cx + width / 2, yy + h / 2],
                         radius=h // 2, fill=(255, 255, 255, 236))
    # subtle tint lower line
    if i == 2:
        ld.rounded_rectangle([cx - width / 2, yy - h / 2, cx + width / 2, yy + h / 2],
                             radius=h // 2, fill=(224, 250, 255, 205))

# little handle / sparkle at bottom
r = int(W * 0.036)
ld.ellipse([cx - r, int(W * 0.665), cx + r, int(W * 0.665) + 2 * r], fill=(130, 255, 225, 240))
# gloss streak on slab
gloss = Image.new("RGBA", (W, W), (0, 0, 0, 0))
gd3 = ImageDraw.Draw(gloss)
gd3.ellipse([-W * 0.1, -W * 0.25, W * 0.55, W * 0.38], fill=(255, 255, 255, 60))
gloss = gloss.filter(ImageFilter.GaussianBlur(70 * SS))
gloss.putalpha(Image.composite(gloss.getchannel("A"), Image.new("L", (W, W), 0), mask))
lines = Image.alpha_composite(lines, gloss)
img = Image.alpha_composite(img, lines)

# ---- outer rim highlight ----
rim = Image.new("RGBA", (W, W), (0, 0, 0, 0))
rd = ImageDraw.Draw(rim)
rd.rounded_rectangle([pad, pad, W - pad, W - pad], radius=radius, outline=(255, 255, 255, 70), width=int(W * 0.007))
img = Image.alpha_composite(img, rim)

img = img.resize((S, S), Image.LANCZOS)
img.save("assets/icon.png")

sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
img.save("assets/icon.ico", sizes=[(s, s) for s in sizes])
print("wrote assets/icon.png and assets/icon.ico")
