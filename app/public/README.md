# Brand assets

`logo.png` is the master: 1024×1024, RGBA, transparent outside the badge.
Everything else here is generated from it.

## Regenerating

```bash
cd app/public
for s in 512 192 32 16; do sips -s format png -Z $s logo.png --out "icon-$s.png"; done
sips -s format png -Z 180 logo.png --out apple-touch-icon.png
```

| File | Used by |
|---|---|
| `logo.png` | site header |
| `icon-512.png` | `og:image`, `twitter:image`, token metadata |
| `icon-192.png` | Android home screen |
| `apple-touch-icon.png` | iOS home screen |
| `icon-32.png`, `icon-16.png` | browser tab |

## The favicon still needs a different crop

The 32 and 16 are currently downscaled from the full badge, and at that size a
boy and a dog cheek to cheek become an unreadable smudge. That is a property of
the composition, not the file format — a vector version would be no better.

The fix is a second mark: **the dog's head alone**, cropped from the same
artwork so it is recognisably the same character. Save it as `mark.png`, square
and 512×512 or larger, then:

```bash
cd app/public
sips -s format png -Z 32 mark.png --out icon-32.png
sips -s format png -Z 16 mark.png --out icon-16.png
```

Nothing else changes — `index.html` already points at those filenames.

## Not served

`logo.png` is 660 KB, which is heavy for a 44px header mark. It is kept at full
resolution because it is also the source for every export above. If page weight
ever matters, point the header at `icon-192.png` instead; the file is 48 KB and
indistinguishable at that size.
