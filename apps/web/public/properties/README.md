# Property cover images

Drop JPG / WebP files here; Vite serves them at `/properties/<filename>`.
The URL stored in the `properties.cover_image_url` column is what the
dashboard banner uses — keep the two in sync.

Expected files (seeded by migration `0010_properties_cover_image.sql`):

- `arxontiko-hotel.jpg` → Arxontiko Hotel (position 0)
- `aesthesis-arxontiko.jpg` → Aesthesis Arxontiko (position 1)

Dimensions: the banner is wide and short (roughly 1600×240 rendered). Use a
landscape photo with the subject near the center — left/right edges may be
cropped on narrow viewports.

When we move to blob storage, just update `cover_image_url` to the absolute
URL; no code changes needed.
