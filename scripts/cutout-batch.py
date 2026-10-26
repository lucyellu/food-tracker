"""Cut out every image in the given dirs into tmp/food-photos/new-cut/<slug>.webp and write a contact sheet."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
from rembg import new_session, remove

s = new_session("isnet-general-use")
out = Path("tmp/food-photos/new-cut"); out.mkdir(parents=True, exist_ok=True)
names = []
for d in sys.argv[1:]:
    for f in sorted(Path(d).iterdir()):
        img = Image.open(f).convert("RGB")
        if max(img.size) < 400:
            img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
        r = remove(img, session=s)
        box = r.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
        if not box:
            continue
        r = r.crop(box); r.thumbnail((512, 512)); r.save(out / f"{f.stem}.webp", "WEBP", quality=90, method=6)
        names.append(f.stem)
sh = Image.new("RGB", (5 * 210, 5 * 230), (120, 150, 135)); dr = ImageDraw.Draw(sh)
for i, n in enumerate(names[:25]):
    im = Image.open(out / f"{n}.webp").convert("RGBA"); im.thumbnail((200, 190))
    x, y = (i % 5) * 210, (i // 5) * 230; sh.paste(im, (x + 5, y + 2), im); dr.text((x + 5, y + 205), n[:32], fill=(255, 255, 255))
sh.save("tmp/food-photos/new-sheet.png"); print(len(names))
