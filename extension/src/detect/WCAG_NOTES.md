# WCAG 2.3.1 notes for the detector

Owner: detection engine. Status: planning only, no code. Read against WCAG 2.2 on 2026-11-06.

Sources:
- Success Criterion 2.3.1, Three Flashes or Below Threshold: https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold
- Understanding 2.3.1: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- Glossary, "general flash and red flash thresholds", "flash", "relative luminance": https://www.w3.org/TR/WCAG22/#dfn-general-flash-and-red-flash-thresholds

This is a summary in our own words, not a legal reading. Where it matters, check the glossary text itself. Nothing here makes the shield a medical device or a guarantee.

## 1. The rule

Content passes if, in any one-second window, **either**:
- it has no more than three general flashes and no more than three red flashes, **or**
- the combined area of the flashes happening at the same moment is small enough (below).

So a failure needs both: more than three flashes in one second **and** a large enough flashing area.

## 2. Definitions

**Flash.** A pair of opposing changes in relative luminance: up then down, or down then up. A flash is two opposing transitions. A transition is the change between adjacent peaks and valleys of a luminance-over-time plot.

**Relative luminance.** sRGB channels `c/255`, linearised (`<= 0.04045` then `/12.92`, else `((c+0.055)/1.055)^2.4`), then `L = 0.2126 R + 0.7152 G + 0.0722 B`, range 0 to 1. (WCAG changed the cut-off from 0.03928 to 0.04045 in 2021; no practical difference.)

**General flash.** An opposing pair of luminance changes where each change is 10% or more of the maximum relative luminance (1.0), and the darker of the two states is below 0.80.

**Red flash.** An opposing pair of transitions involving a saturated red. Working definition (Note 3 of the glossary entry): one of the states has `R/(R+G+B) >= 0.8`, and the two states differ by more than 0.2 in the CIE 1976 UCS chromaticity diagram, i.e. `sqrt((u'1-u'2)^2 + (v'1-v'2)^2) > 0.2`.

**Area.** The flashing area counted is the area actually flashing at the same time, not each element on its own. The limit is 0.006 steradians within any 10 degree visual field on the screen, which is 25% of that field. Note 1 gives an estimate: a 341 x 256 pixel rectangle anywhere on the screen at 1024 x 768 stands for a 10 degree field.

**Exception.** Fine, balanced patterns (white noise, a checkerboard with squares under 0.1 degree) are exempt. We do not implement this exception. Not implementing it errs on the side of flagging, which is the right direction for us.

## 3. Our constants

| Name | Value | Notes |
|---|---|---|
| `LUMA_DELTA` | `0.10` | Minimum swing per transition, on the 0..1 relative luminance scale |
| `DARK_STATE_MAX` | `0.80` | The darker state of the pair must be below this |
| `WINDOW_MS` | `1000` | Half-open window `(t - 1000, t]`, real timestamps only |
| `MAX_FLASHES` | `3` (wcag), `2` (strict) | Violation when flashes in the window is greater than this |
| `AREA_FRACTION` | `0.25` | Of the 10 degree field |
| `FIELD_PX` | `341 * 256 = 87,296` | Estimate at 1024 x 768 |
| `AREA_PX_WCAG` | `0.25 * 87,296 = 21,824` | The pixel area threshold for the `wcag` preset |
| `AREA_PX_STRICT` | to be chosen, proposal `10,912` (half) | Product choice, not the spec. Strict also flags any red flash |
| `RED_SHARE_MIN` | `0.8` | `R/(R+G+B)` |
| `RED_CHROMA_DELTA` | `0.2` | CIE 1976 UCS distance |

Flash counting convention (a design decision, see DESIGN.md section 3): a window holding `n` alternating transitions has `ceil(n/2)` flashes. So 7 transitions in one second counts as 4 flashes. That makes the cut-off exactly "more than 3 cycles per second", matching "period shorter than about 333 ms fails".

## 4. Where `docs/PROJECT_PLAN.md` section 3 needs fixing

1. **Red flash formula is left open, and the version in the older WCAG 2.0 text is different.** WCAG 2.0 used `(R-G-B)*320 > 20` for the transition; WCAG 2.1 and 2.2 use the `R/(R+G+B) >= 0.8` plus CIE 1976 UCS distance `> 0.2` rule above. We implement the 2.2 version. (The 2.0 formula is from memory of the older text, I did not re-fetch it. It is only mentioned so nobody "fixes" the code to it.) The plan should state the 2.2 rule instead of "confirm before coding".
2. **Area scaling by `devicePixelRatio` is probably wrong.** The 341 x 256 estimate is already in screen pixels at a stated resolution, and CSS pixels are defined to match viewing angle across devices. Multiplying by `devicePixelRatio` would make retina screens count 2x or more per CSS pixel. Proposal: measure area in **CSS pixels**, and let browser zoom change the scale (zoom changes the angle a CSS pixel covers, so scale the threshold by `1/zoom^2`). `realAreaScale` in the contract should be defined as "CSS px per sample px".
3. **"at least 25%" is the wrong direction.** The spec passes content when the flashing area is *no more than* 25% of the field, so a violation needs the area to be *greater than* 21,824 px. A tie passes. Trivial but it matters for the "exactly at threshold" test.
4. **The area is measured against the screen, not the element.** The plan's `areaPct` (`areaPx / element visible area`) is fine for the HUD but the violation test must use absolute pixels (and, for multiple elements, a sum, see DESIGN.md section 5).
5. **"Each change at least 10% of the maximum relative luminance"** is clear but is easy to implement as a *relative* 10% of the current value. It is a fixed `0.10` absolute change on the 0..1 scale.
6. **Frequency wording.** "More than 3 flashes in any one-second window" with "a flash is two opposing transitions" can be read two ways at the edge (6 vs 7 transitions). Section 3 above fixes the reading we use; the plan should say so.
7. **The red-flash note** says "a change in a red-dominance value". In 2.2 it is a chromaticity distance, not a red-dominance value.

## 5. Known limits worth stating in the README

- We analyse downscaled sRGB frames, not the display output. HDR, wide-gamut, colour management and display brightness are not modelled.
- Viewing angle is assumed from CSS pixels. A user on a very large screen sitting close sees a larger angle than we assume.
- Unreadable media (cross-origin, DRM, tainted canvas) is dimmed, not measured.
