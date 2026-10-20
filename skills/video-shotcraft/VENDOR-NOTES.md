# video-shotcraft — vendor notes (maestro-authored)

*This file is maestro's manifest, not upstream material — everything else in this tree is an unmodified copy. Named `VENDOR-NOTES.md` rather than `README.md` so it never occupies the authors' own README path, and excluded from re-vendoring (`../../../../UPDATING.md`).*

Source: [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft), Apache-2.0 (`LICENSE` carried alongside; upstream ships no NOTICE file). Distilled judgment layer: `../../references/video-shotcraft.md` and `../../references/video-sound.md`.

The upstream project is ~164 MB, most of it rendered video and captured textures. What ships here is everything an agent reads; only heavy binaries are left behind.

## Vendored here

| Path | What it is |
|---|---|
| `references/shots/<category>/` | **157 shot cards** *(count as vendored — upstream adds cards weekly, so treat it as a snapshot and count the directory if the exact number matters)* — the vocabulary, filed under ten functional categories (`opening` `typography` `ui-entrance` `camera` `data` `interaction` `transition` `rhythm` `effects` `outro`). Frontmatter (name · one-liner · when to use · duration · energy), then intent, motion core, a parameter table with tuning feel, sound notes, known traps |
| `references/pipeline.md` | The eight-stage production pipeline (autonomous mode runs it end to end) |
| `references/guided-free-creation.md` | Co-creation mode: the same pipeline with user sign-off gates at stages 0–3 |
| `references/aesthetic-rules.md` | The quality standard as precedents — R rhythm · Q texture/camera/composition · S sound · C copy · P process |
| `references/sound-design.md` · `references/music-beat-sync.md` | Sound methodology and the beat-grid analysis method |
| `references/final-review.md` | The independent pre-delivery review checklist |
| `references/sequences/` | Whole-film energy skeletons to fill in before picking cards |
| `demos/<category>/` | The tuned reference implementation for **all 157 cards**, in the same ten categories — copy into a Remotion project and run. `demos/_fixtures/` is vendored too, and holds **two** unrelated shared modules: `Fixtures.tsx` (the fake-UI scene pieces) and `Motion.tsx` (the design-coordinate stage the 48 motion-lab cards build on — read it before adapting one of those) |
| `template/src/` | The reference film's source — kept for `aifl/Main.tsx` — the central SFX pin table the whole sound methodology is drawn from |
| `template/TEMPLATE.md` + `package.json` · `remotion.config.ts` · `tsconfig.json` | The replace-guide template mode follows, and the project config that makes the source buildable |
| `assets/lib/` | Components to copy (not import): `PageCam`, `DigitRoll`, `FlashCut`, `Caption`, `FlatPanel`, `VerticalTicker`, `helpers/` |
| `assets/scripts/capture-template.mjs` | The page-capture script `pipeline.md` stage 4 says to copy and configure |
| `assets/audio/ATTRIBUTION.md` | Manifest of the SFX/BGM library — `bgm/` plus 149 sounds in 16 categories, with names, uses, licensing, and known gaps |
| `assets/audio/AUDITION-2026-07-27.md` | Per-file audition data — duration, measured peak, suggested pin point — which is what makes the windowing and level rules usable without the binaries |
| `SKILL.md` | The upstream router, kept for provenance |

**Every card's implementation resolves, and all 157 now resolve to `demos/<category>/<name>/`.** Earlier vendors of this tree recorded a 143/9 split, with nine energy-arc defaults implemented only inside the reference film; upstream has since given each of them its own demo, so that split is gone. The template source is still vendored — not for those nine, but because `template/src/aifl/Main.tsx` is the central SFX pin table the sound methodology is drawn from.

One demo directory, `demos/interaction/clipcard-looping/`, has no card of its own. Treat it as a bonus implementation rather than a missing card.

## Deliberately upstream

| Not here | Why, and how to get it |
|---|---|
| `gallery/` (161 preview clips) | Browse the hosted gallery instead: <https://vincentwei1021.github.io/video-shotcraft/library.html> — the right way to let a user *watch* shots and pick by name. The clips now live in a release rather than in git, so even an upstream clone must run `gallery/fetch-media.sh` before serving it locally |
| `template/out/` (15 MB rendered film) · `template/public/` (7.6 MB page textures) | The template's **source** is vendored and readable, but without its textures and output the project won't render as-is. Clone upstream to run it |
| `assets/audio/*.mp3` (~30 MB of SFX + BGM) | Clone upstream, or source equivalents per the licensing guidance in `../../references/video-sound.md`. The manifest above says what exists |
| `demos/_textures/` (real-page captures) | Four demos import these and won't run standalone without them; their card documentation is still complete |

## Notes

- **Every file here except this one is Chinese-language source material.** The distilled modules carry maestro's English voice; these are the authors' own. Read them directly — don't translate a card and then work from the translation, since the parameter tables and the known-traps sections are where the value is.
- Card names resolve to `references/shots/<category>/<name>.md` plus the implementation that card names. The upstream `gallery/api/library.json` (not vendored) is the canonical name/style-key index; the hosted gallery exposes the same names.
- Don't edit vendored files. Local judgment belongs in the distilled modules; this tree is refreshed wholesale from upstream.

**Provenance.** `references/shots/ATTRIBUTION.md` documents the 48 motion-lab cards as clean-room re-implementations of publicly released promos and OSS sites, with the legal boundary stated: public release is not a licence to reproduce. Treat those cards as technique references, not as artwork to ship verbatim.
