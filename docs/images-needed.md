# Image Inventory — Wave 1 Reference

Wave 0 only copied the logo (`public/logo/gb-whittier-logo.png`). Wave 1
page-builders pick specific images from the source folders below and copy
them into `public/images/` with descriptive, lowercase, hyphenated filenames
(e.g. `homepage-hero.webp`, `kids-class-tiny-champions-1.jpg`).

Source root: `Website Media/` (do NOT delete; do NOT commit large originals
to the repo — process via `<Image>` for WebP/AVIF output).

## Folder map

### `Website Media/Brand/`
- `stacked-logo 2.png` — already copied to `public/logo/gb-whittier-logo.png`
- `Rectangle.png` — alternate brand asset (TBD use)

### `Website Media/Home page photos/`
- `692f45df2b865e09c86968ff.jpg`
- `tmp1rbic7xj.jpg`
- `tmpr49fqjhq.webp`
- `tmps02m490w.webp`
- `tmpv37wv38d.jpg`

### `Website Media/Homepage/`
- `Homepage-Hero.png` — likely homepage hero candidate
- `Program Card_ Adults.png` — adult program card art
- `Program Card_ Kids.png` — kids program card art
- `Gracie Barra_Custom Background_Adult 1.png` — section background

### `Website Media/Adults Classes/`
40+ photos prefixed `A97A####.jpg/.png` — pick best for Adults page hero,
gallery, and cards. Recommended: scan for high-energy training shots and
clean fundamentals shots (mix).

### `Website Media/Kids Classes/`
40+ photos prefixed `0Q3A####.jpg` and `A97A####.jpg`. Pick a mix of:
- Tiny Champions (smallest kids)
- Little Champions
- Juniors (older kids/teens)
- Group/team shots

### `Website Media/Student Profiles/`
- `AdrianPastor1.png`
- `ERIC NOSTRAND2.jpg`
- `ErikSolorio1.png`
- `FRANK NOSTRAND.jpg`, `FRANK NOSTRAND1.jpg`, `FRANK NOSTRAND2.jpg`
- `JayleenAlba.png`
- `JordanMcanlly.png`
- `LUKE NOSTRAND.jpg`, `LUKE NOSTRAND1.jpg`
- `NancyAlverez.png`
- `Nostrand Men copy.jpg`
- `VioletSerrano2.png`
- `ZoeMartinez.png`
- `Mask group.png`, `Mask group(1).png`

Use for testimonial cards, instructor bios, and student-of-the-month sections.

### `Website Media/` (loose files)
- `GBWhittierTEAM2024.jpg` — team photo, footer/about candidate
- `Gracie Barra_Custom Background_Adult 1.png` — background fill
- `HERO.png` — full hero candidate
- `Schedule-2.pdf` — class schedule (link from Contact page)
- `Vector-2.png` — decorative vector

## Slot recommendations (Wave 1)

| Page | Slot | Suggested source |
|---|---|---|
| `/` | Hero | `Homepage/Homepage-Hero.png` or `HERO.png` |
| `/` | Programs grid kids art | `Homepage/Program Card_ Kids.png` |
| `/` | Programs grid adults art | `Homepage/Program Card_ Adults.png` |
| `/` | Team / about strip | `GBWhittierTEAM2024.jpg` |
| `/kids-martial-arts` | Hero | best Kids Classes group shot |
| `/kids-martial-arts` | Tiny Champions | youngest-kids photo |
| `/kids-martial-arts` | Juniors | teens photo |
| `/adults-jiu-jitsu` | Hero | strong adults action shot |
| `/adults-jiu-jitsu` | Fundamentals | adults pair drilling |
| `/reviews` | Avatars | Student Profiles |
| `/contact` | Building exterior | (user to provide) |

## Naming convention for `public/images/`

- lowercase, hyphenated: `homepage-hero.webp`, not `Homepage-Hero.png`
- include page slug as prefix where it helps: `kids-tiny-champions-1.jpg`
- prefer `.webp` for output; original `.png`/`.jpg` stays in `Website Media/`
- alt text in component must include location keyword where natural
  (e.g. "Adult Brazilian Jiu-Jitsu class at Gracie Barra Whittier")
