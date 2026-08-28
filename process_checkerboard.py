from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


BASE = Path(r"C:\Users\掉蛋\.codex\generated_images\01a0383f-9b25-7150-8228-cd8c9b7fa13a")
OUT = Path(r"C:\Users\掉蛋\.codex\visualizations\2026\08\25\01a0383f-9b25-7150-8228-cd8c9b7fa13a\second-batch-transparent-work")
OUT.mkdir(parents=True, exist_ok=True)

FILES = {
    "麻辣香锅": BASE / "exec-529515bf-a808-4550-8d13-7b78382d6ba6.png",
    "宫保鸡丁": BASE / "exec-028e9489-b5ed-465e-bb53-4f31ff8e224f.png",
    "杨枝甘露": BASE / "exec-2428399a-ce09-41d2-897b-502b5cab4eaf.png",
}


def checker_template(rgb: np.ndarray, strip: int = 10) -> np.ndarray:
    """Learn the checker as two separable edge profiles, including soft tile transitions."""
    f = rgb.astype(np.float32)
    lum = f.mean(axis=2)
    edge_values = np.concatenate((lum[:64].ravel(), lum[-64:].ravel()))

    # Stable two-cluster fit for the light and dark checker tiles.
    centers = np.array([np.percentile(edge_values, 20), np.percentile(edge_values, 80)])
    for _ in range(12):
        labels = np.abs(edge_values[:, None] - centers[None, :]).argmin(axis=1)
        centers = np.array([edge_values[labels == i].mean() for i in range(2)])
    dark, light = np.sort(centers)
    mid = float((dark + light) * 0.5)

    top_profile = np.median(lum[:strip], axis=0)
    left_profile = np.median(lum[:, :strip], axis=1)
    top_dev = top_profile - mid
    left_dev = left_profile - mid
    corner_dev = float(np.median(lum[:strip, :strip]) - mid)
    if abs(corner_dev) < 1.0:
        raise RuntimeError("Unable to infer checkerboard phase from canvas edges")

    expected_lum = mid + np.outer(left_dev, top_dev) / corner_dev
    expected_lum = np.clip(expected_lum, dark - 1.0, light + 1.0)

    # Preserve the tiny neutral channel bias found in the actual background.
    edge_rgb = np.concatenate((f[:64].reshape(-1, 3), f[-64:].reshape(-1, 3)), axis=0)
    channel_bias = np.median(edge_rgb - edge_rgb.mean(axis=1, keepdims=True), axis=0)
    return expected_lum[..., None] + channel_bias


def flood_component(mask: np.ndarray, seed: tuple[int, int]) -> np.ndarray:
    """Return a scanline-filled 4-connected component in a boolean mask."""
    h, w = mask.shape
    x, y = seed
    if not (0 <= x < w and 0 <= y < h and mask[y, x]):
        return np.zeros_like(mask)
    filled = np.zeros_like(mask, dtype=bool)
    stack = [(x, y)]
    while stack:
        sx, sy = stack.pop()
        if filled[sy, sx] or not mask[sy, sx]:
            continue
        left = sx
        while left > 0 and mask[sy, left - 1] and not filled[sy, left - 1]:
            left -= 1
        right = sx
        while right + 1 < w and mask[sy, right + 1] and not filled[sy, right + 1]:
            right += 1
        filled[sy, left : right + 1] = True
        for ny in (sy - 1, sy + 1):
            if not (0 <= ny < h):
                continue
            segment = mask[ny, left : right + 1] & ~filled[ny, left : right + 1]
            starts = np.flatnonzero(segment & np.r_[True, ~segment[:-1]])
            for start in starts:
                stack.append((left + int(start), ny))
    return filled


def central_solid_mask(rgb: np.ndarray, expected: np.ndarray) -> np.ndarray:
    """Find the central sticker through chroma/warmth, then fill its enclosed interior."""
    h, w, _ = rgb.shape
    f = rgb.astype(np.float32)
    chroma = f.max(axis=2) - f.min(axis=2)
    warmth = f[..., 0] - (f[..., 1] + f[..., 2]) * 0.5
    residual = np.sqrt(np.mean((f - expected.astype(np.float32)) ** 2, axis=2))

    # The checker is essentially neutral. Food, ceramic cream, and glass highlights
    # have stable chroma/warmth; neutral low-opacity shadows do not enter this seed.
    evidence = ((chroma >= 8.0) | (warmth >= 5.0)) & (residual >= 4.0)

    # Ignore any tiny colored compression specks far from the centered sticker.
    yy, xx = np.indices((h, w))
    ellipse = ((xx - w / 2) / (w * 0.50)) ** 2 + ((yy - h / 2) / (h * 0.49)) ** 2 <= 1.0
    evidence &= ellipse

    # Close small gaps in the cream outline without globally selecting light pixels.
    ev = Image.fromarray((evidence.astype(np.uint8) * 255), mode="L")
    ev = ev.filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.MinFilter(31))
    closed = np.asarray(ev) > 0

    # Flood the inverse from the canvas edge; everything enclosed is the sticker.
    traversable = ~closed
    outside = flood_component(traversable, (0, 0))
    enclosed = ~outside

    # Retain only the large centered component, excluding isolated background specks.
    component = flood_component(enclosed, (w // 2, h // 2))
    print("mask_debug", int(evidence.sum()), int(closed.sum()), int(enclosed.sum()), int(component.sum()), bool(enclosed[h // 2, w // 2]))
    if component.sum() < h * w * 0.03:
        raise RuntimeError("Central sticker component was not found reliably")
    return component


def near_mask(mask: np.ndarray) -> np.ndarray:
    """A roughly 56-pixel exterior band for antialiasing and the existing shadow."""
    h, w = mask.shape
    small = Image.fromarray((mask.astype(np.uint8) * 255), mode="L").resize(
        (max(1, w // 4), max(1, h // 4)), Image.Resampling.NEAREST
    )
    expanded = small.filter(ImageFilter.MaxFilter(17)).resize((w, h), Image.Resampling.NEAREST)
    return np.asarray(expanded) > 0


def connected_shadow(candidate: np.ndarray, solid: np.ndarray) -> np.ndarray:
    """Keep only smooth shadow regions that grow outward from the sticker boundary."""
    cleaned_img = Image.fromarray((candidate.astype(np.uint8) * 255), mode="L")
    cleaned_img = cleaned_img.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    cleaned = np.asarray(cleaned_img) > 0
    solid_img = Image.fromarray((solid.astype(np.uint8) * 255), mode="L")
    adjacent = np.asarray(solid_img.filter(ImageFilter.MaxFilter(21))) > 0
    connected = cleaned & adjacent
    for _ in range(48):
        grown_img = Image.fromarray((connected.astype(np.uint8) * 255), mode="L").filter(ImageFilter.MaxFilter(3))
        grown = (np.asarray(grown_img) > 0) & cleaned
        if np.array_equal(grown, connected):
            break
        connected = grown
    return connected


def process(name: str, source: Path) -> None:
    rgb_u8 = np.asarray(Image.open(source).convert("RGB"))
    rgb = rgb_u8.astype(np.float32)
    expected = checker_template(rgb_u8).astype(np.float32)
    h, w, _ = rgb.shape

    solid = central_solid_mask(rgb_u8, expected)
    near = near_mask(solid)

    diff = rgb - expected
    residual = np.sqrt(np.mean(diff * diff, axis=2))
    yy, _ = np.indices((h, w))
    safe = (yy < 64) | (yy >= h - 64)
    noise_floor = max(3.0, float(np.percentile(residual[safe], 99.9)) + 0.6)

    # Preserve the connected central sticker exactly. Only the external nearby band
    # can become semitransparent, so no food/plate/cup interior can acquire holes.
    alpha = np.zeros((h, w), dtype=np.float32)
    alpha[solid] = 1.0

    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    darkening = expected.mean(axis=2) - rgb.mean(axis=2)
    dark_encoded = np.rint((np.clip(darkening, -32.0, 96.0) + 32.0) * (255.0 / 128.0)).astype(np.uint8)
    dark_blurred = np.asarray(Image.fromarray(dark_encoded, mode="L").filter(ImageFilter.GaussianBlur(4.0)))
    darkening_smooth = dark_blurred.astype(np.float32) * (128.0 / 255.0) - 32.0
    shadow_floor = max(1.0, float(np.percentile(darkening_smooth[safe], 99.9)) + 0.5)
    exterior = near & ~solid & (darkening_smooth > shadow_floor) & (chroma <= 14.0)
    exterior = connected_shadow(exterior, solid)
    b = expected
    c = rgb

    # Minimum mathematically valid alpha for uncompositing C = aF + (1-a)B.
    shadow_rgb = np.array([132.0, 130.0, 127.0], dtype=np.float32)
    shadow_lum = float(shadow_rgb.mean())
    ext_alpha = np.clip(darkening_smooth / np.maximum(expected.mean(axis=2) - shadow_lum, 1.0), 0.0, 1.0)
    alpha[exterior] = ext_alpha[exterior]

    # Recover foreground RGB for semitransparent antialias/shadow pixels. This removes
    # the alternating checker contribution while reproducing the original composite.
    out_rgb = rgb.copy()
    sem = (alpha > 0.0) & (alpha < 0.999)
    a = alpha[sem, None]
    out_rgb[sem] = shadow_rgb
    out_rgb[alpha == 0.0] = 0.0

    rgba = np.dstack((np.rint(out_rgb).astype(np.uint8), np.rint(alpha * 255).astype(np.uint8)))
    target = OUT / f"{name}_第二批透明版.png"
    Image.fromarray(rgba, mode="RGBA").save(target, format="PNG")

    # Two solid-color composites and an alpha visualization for magnified QA.
    sticker = Image.fromarray(rgba, mode="RGBA")
    preview = Image.new("RGBA", (w * 2, h), (0, 0, 0, 0))
    left = Image.new("RGBA", (w, h), (246, 240, 224, 255))
    right = Image.new("RGBA", (w, h), (55, 73, 78, 255))
    left.alpha_composite(sticker)
    right.alpha_composite(sticker)
    preview.alpha_composite(left, (0, 0))
    preview.alpha_composite(right, (w, 0))
    preview.convert("RGB").save(OUT / f"{name}_双底检查.jpg", quality=94)
    Image.fromarray(rgba[..., 3], mode="L").save(OUT / f"{name}_Alpha检查.png")

    opaque_rgb_same = np.array_equal(rgba[..., :3][rgba[..., 3] == 255], rgb_u8[rgba[..., 3] == 255])
    print(
        f"{name}\t{w}x{h}\tnoise={noise_floor:.2f}\t"
        f"opaque={int((rgba[...,3] == 255).sum())}\t"
        f"semi={int(((rgba[...,3] > 0) & (rgba[...,3] < 255)).sum())}\t"
        f"clear={int((rgba[...,3] == 0).sum())}\t"
        f"corners={rgba[0,0,3]},{rgba[0,-1,3]},{rgba[-1,0,3]},{rgba[-1,-1,3]}\t"
        f"opaque_rgb_same={opaque_rgb_same}\ttarget={target}"
    )


for item_name, item_source in FILES.items():
    process(item_name, item_source)
