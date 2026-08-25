Implementation notes:

- Runtime production paths remain neutral because every tuning axis defaults to 1.0.
- Experimental tuning is carried only by an ephemeral source object during candidate renders.
- The dispatcher forwards tuning into the family-specific physical overlay.
- No registered engineVersion is changed in this PR because baseline acoustic output is unchanged when tuning is absent.
- Promotion of a successful candidate must change the real family profile and then bump engineVersion.
