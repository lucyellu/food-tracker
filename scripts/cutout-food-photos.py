"""Strip backgrounds from tmp/food-photos/raw/* into public/foods/<slug>.webp (trimmed, max 512px)."""
import sys
from pathlib import Path
from PIL import Image
from rembg import new_session, remove

raw = Path("tmp/food-photos/raw")
out = Path("public/foods")
out.mkdir(parents=True, exist_ok=True)
session = new_session("isnet-general-use")
done = 0
for src in sorted(raw.iterdir()):
    dest = out / f"{src.stem}.webp"
    if dest.exists() and "--force" not in sys.argv:
        continue
    try:
        img = remove(Image.open(src).convert("RGB"), session=session)
        box = img.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
        if not box:
            print("empty", src.name)
            continue
        img = img.crop(box)
        img.thumbnail((512, 512))
        img.save(dest, "WEBP", quality=88, method=6)
        done += 1
    except Exception as e:
        print("fail", src.name, e)
print("cut out", done)
