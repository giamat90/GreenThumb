"""
Generate app icon, adaptive icon, splash icon, and favicon
from the full logo by cropping out the "Green Thumb" text,
keeping only the fingerprint.
"""

from PIL import Image

CREAM = (246, 239, 221)  # #F6EFDD
LOGO_PATH = "assets/images/logo.png"
THRESHOLD = 40  # color distance threshold for background detection

# Open the source logo (1600x1600, fingerprint + "Green Thumb" text)
img = Image.open(LOGO_PATH)
w, h = img.size
print(f"Source logo: {w}x{h}")

# Crop bottom ~30% to remove the "Green Thumb" text completely
crop_y = int(h * 0.70)
cropped = img.crop((0, 0, w, crop_y))

# Find tight bounding box of the fingerprint using threshold-based detection
# (background isn't perfectly uniform due to JPEG artifacts in source)
pixels = cropped.load()
cw, ch = cropped.size
top, bottom, left, right = ch, 0, cw, 0

for y in range(ch):
    for x in range(cw):
        r, g, b = pixels[x, y][:3]
        dr = abs(r - CREAM[0])
        dg = abs(g - CREAM[1])
        db = abs(b - CREAM[2])
        if dr > THRESHOLD or dg > THRESHOLD or db > THRESHOLD:
            top = min(top, y)
            bottom = max(bottom, y)
            left = min(left, x)
            right = max(right, x)

if bottom <= top or right <= left:
    raise RuntimeError("Could not detect fingerprint bounding box")

bbox = (left, top, right + 1, bottom + 1)

fingerprint = cropped.crop(bbox)
fw, fh = fingerprint.size
print(f"Fingerprint extracted: {fw}x{fh} from bbox {bbox}")


def place_centered(fingerprint_img, canvas_size, max_content_size):
    """Place fingerprint centered on a cream canvas at the given max size."""
    canvas = Image.new("RGB", (canvas_size, canvas_size), CREAM)
    fp = fingerprint_img.copy()
    fp.thumbnail((max_content_size, max_content_size), Image.LANCZOS)
    x = (canvas_size - fp.width) // 2
    y = (canvas_size - fp.height) // 2
    canvas.paste(fp, (x, y))
    return canvas


# App icon: 1024x1024, fingerprint fills ~80%
icon = place_centered(fingerprint, 1024, 820)
icon.save("assets/images/app-icon.png")
print("Created: assets/images/app-icon.png (1024x1024)")

# Android adaptive icon: 1024x1024, fingerprint fills ~58% (safe zone)
adaptive = place_centered(fingerprint, 1024, 600)
adaptive.save("assets/images/adaptive-icon.png")
print("Created: assets/images/adaptive-icon.png (1024x1024)")

# Splash icon: 1024x1024, fingerprint fills ~75%
splash = place_centered(fingerprint, 1024, 768)
splash.save("assets/images/splash-icon.png")
print("Created: assets/images/splash-icon.png (1024x1024)")

# Favicon: 48x48
favicon = place_centered(fingerprint, 48, 40)
favicon.save("assets/images/favicon.png")
print("Created: assets/images/favicon.png (48x48)")

print("\nDone! All icons generated.")
