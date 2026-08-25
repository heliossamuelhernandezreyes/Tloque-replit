# Hybrid A/B Register Matrix v1

## Goal

A hybrid engine must not reach Master because it behaves well only near the middle of an instrument. Acoustic Lab now validates three representative regions of the declared hybrid range: `low`, `mid`, and `high`.

## Probe layout

Each blind A/B file contains three consecutive 5-bar sections at 120 BPM. Each section lasts 10 seconds and uses the same velocity contrast, sustain gesture, legato event, and family-specific TloqueScore 2.2 physical controls. Representative MIDI points are sampled near 22%, 50%, and 78% of the declared hybrid range instead of at the absolute endpoints, where source libraries can be sparse or atypical.

The listening order is always low → mid → high, but A/B identity remains randomized and hidden until the reviewer votes.

## Objective evidence

Every register produces the five existing metrics independently:

- transient preservation
- sustain continuity
- dynamic response
- spectral deviation
- tail naturalness

The top-level metric for the report is the **worst register** for that metric. For metrics with a minimum target, the global value is the minimum observed value. For spectral deviation, where lower is better, the global value is the maximum observed value.

No averaging is allowed for Master evidence.

## Master gate

Master evidence requires exactly one result for each of `low`, `mid`, and `high`. Every metric in every register must pass, the worst-case top-level metrics must pass, the report must target the exact engine version, and the human review must be a blind A/B preference for the hybrid.

Legacy reports without register coverage are intentionally invalid for Master. They may remain useful as historical Studio evidence but must be regenerated before promotion.
