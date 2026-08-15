# Brand assets

Two marks, not one, because a boy and a dog cheek to cheek stop being
readable somewhere around 64px. Which one to use is decided by size, not by
context.

| Source | Master | Used for |
|---|---|---|
| `logo.png` | 1024×1024 full badge | the scene, with the wordmark |
| `favicons/favicon_512.png` | 512×512 dog's head | everything small |

## Generated files

| File | From | Used by |
|---|---|---|
| `badge-512.png` | `logo.png` | `og:image`, `twitter:image`, token metadata, pump.fun |
| `mark-192.png` | the crop | site header (44px) |
| `apple-touch-icon.png` | the crop | iOS home screen |
| `mark-32.png`, `mark-16.png` | the crop | browser tab |
| `favicon.ico` | supplied | browser tab, legacy |

Nothing small is a downscale of the badge. That was the earlier mistake: the
structure disappeared entirely in the tab.

## Regenerating

```bash
cd app/public
sips -s format png -Z 512 logo.png --out badge-512.png
for s in 192 32 16; do sips -s format png -Z $s favicons/favicon_512.png --out "mark-$s.png"; done
sips -s format png -Z 180 favicons/favicon_512.png --out apple-touch-icon.png
```

`favicons/` holds the originals as supplied and is not referenced by the app
except as the source above. `favicon.ico` is copied from it verbatim.

## Note on the header

The header shows the dog's head, not the full badge. At 44px the scene is
unreadable, and the wordmark next to it already says "Buddy". The badge earns
its place on link previews and exchange listings, where it is shown big enough
to be understood.

## Not served

`logo.png` is 660 KB and is kept only as the export source. Markdown in this
directory is excluded from the production deploy, so this file is not public.
