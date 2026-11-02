# Tokisla logo generator: black background, gold video-frame, emerald play mark.
# Run: python3 assets/branding/generate_logo.py  (regenerates all logo files)
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
BLACK = (5, 8, 7, 255)
GOLD = (201, 162, 75, 255)
EMERALD = (16, 185, 129, 255)   # bright emerald, readable on black
WHITE = (255, 255, 255, 255)

def draw_mark(size):
    """The Tokisla mark at an exact pixel size (drawn 4x and downscaled)."""
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # black rounded-square background
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=BLACK)
    # gold video frame (screen outline)
    fx0, fy0, fx1, fy1 = int(S * 0.235), int(S * 0.27), int(S * 0.765), int(S * 0.73)
    d.rounded_rectangle([fx0, fy0, fx1, fy1], radius=int(S * 0.075),
                        outline=GOLD, width=int(S * 0.030))
    # emerald play triangle, optically centred inside the frame
    cx, cy = S / 2, S / 2
    w, h = S * 0.185, S * 0.235
    d.polygon([(cx - w * 0.36, cy - h / 2), (cx - w * 0.36, cy + h / 2),
               (cx + w * 0.72, cy)], fill=EMERALD)
    return img.resize((size, size), Image.LANCZOS)

icon512 = draw_mark(512)
icon512.save(os.path.join(OUT, "icon-512.png"))
draw_mark(192).save(os.path.join(OUT, "icon-192.png"))

# Full lockup: mark + "tokisla" wordmark + gold dot (transparent background)
mark = draw_mark(640)
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
font = ImageFont.truetype(font_path, 300)
tmp = Image.new("RGBA", (10, 10))
td = ImageDraw.Draw(tmp)
word = "tokisla"
w_word = td.textlength(word, font=font)
w_dot = td.textlength(".", font=font)
W = 640 + 70 + int(w_word + w_dot) + 30
H = 640
lock = Image.new("RGBA", (W, H), (0, 0, 0, 0))
lock.alpha_composite(mark, (0, 0))
d = ImageDraw.Draw(lock)
bbox = td.textbbox((0, 0), word, font=font)
ty = (H - (bbox[3] - bbox[1])) // 2 - bbox[1]
d.text((640 + 70, ty), word, font=font, fill=WHITE)
d.text((640 + 70 + w_word, ty), ".", font=font, fill=GOLD)
lock.save(os.path.join(OUT, "logo-lockup.png"))
print("logo files regenerated:", os.listdir(OUT))
