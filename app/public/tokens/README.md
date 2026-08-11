# Token artwork

Two folders so the new token's identity can be swapped without touching the
legacy one, which is historical and must never change.

| Folder | What goes in it | Changes? |
|---|---|---|
| `legacy/logo.png` | the original token's artwork, as it actually was | never — it is a record |
| `new/logo.png` | this project's mark | yes, until launch |

Both are rendered at 96px in the handover strip on the landing page, and both
are square. 512×512 is plenty; anything larger is wasted bytes on a mobile
connection.

## Before deploying

`new/logo.png` is currently a copy of `../logo.png`. If the mark changes, only
this file needs replacing — nothing in the code refers to a specific image
beyond these two paths.

```bash
sips -s format png -Z 512 /path/to/new-art.png --out app/public/tokens/new/logo.png
```

## Missing files

`TokenHandover` degrades to a lettered placeholder when an image 404s, so a
missing file does not break the page — it just looks unfinished, which is the
correct signal.
