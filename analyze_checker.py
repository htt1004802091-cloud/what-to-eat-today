from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image


FILES = [
    Path(r"C:\Users\掉蛋\.codex\generated_images\01a0383f-9b25-7150-8228-cd8c9b7fa13a\exec-529515bf-a808-4550-8d13-7b78382d6ba6.png"),
    Path(r"C:\Users\掉蛋\.codex\generated_images\01a0383f-9b25-7150-8228-cd8c9b7fa13a\exec-028e9489-b5ed-465e-bb53-4f31ff8e224f.png"),
    Path(r"C:\Users\掉蛋\.codex\generated_images\01a0383f-9b25-7150-8228-cd8c9b7fa13a\exec-2428399a-ce09-41d2-897b-502b5cab4eaf.png"),
]


for path in FILES:
    rgb = np.asarray(Image.open(path).convert("RGB"))
    h, w, _ = rgb.shape
    border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]), axis=0)
    counts = Counter(map(tuple, border.tolist()))
    print("\n", path.name, rgb.shape)
    print("border top colors", counts.most_common(12))

    # Run-length encoding of the top row by exact RGB.
    row = rgb[0]
    runs = []
    start = 0
    for x in range(1, w + 1):
        if x == w or np.any(row[x] != row[start]):
            runs.append((start, x - 1, tuple(row[start])))
            start = x
    print("top runs", runs[:25])

    # Dominant colors in a wide, guaranteed-background top strip.
    strip = rgb[:80].reshape(-1, 3)
    strip_counts = Counter(map(tuple, strip.tolist()))
    print("top strip colors", strip_counts.most_common(12))

