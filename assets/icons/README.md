# Icon Assets

Place the following files in this folder for Windows tray and taskbar thumbnail toolbar icons.

Required files
- `tray.ico` (recommended) or `tray.png`
- `thumbar-prev.png`
- `thumbar-play.png`
- `thumbar-pause.png`
- `thumbar-next.png`

Optional file
- `thumbar-play-active.png`
  - If provided, it is used for the center button when current state is "play".
  - If not provided, `thumbar-play.png` is used.

Format and size recommendations
- `tray.ico`: multi-size icon containing at least 16x16, 20x20, 24x24, 32x32
- `tray.png`: 32x32 with transparent background
- `thumbar-*.png`: exactly 16x16 with transparent background

Design tips
- Use high-contrast light glyphs (white or near-white) for thumbar icons.
- Keep icon shapes simple and centered.
- Avoid antialias blur at 16x16; use crisp edges.
