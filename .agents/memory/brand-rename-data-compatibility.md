---
name: Brand rename and data compatibility
description: Preserve existing client storage identifiers when changing the visible product name.
---

Visible rebranding must not rename localStorage keys or IndexedDB/localForage database names.

**Why:** Those identifiers are part of the user's existing local data contract; changing them would make saved books, settings, drafts, and progress appear missing.

**How to apply:** Update visible copy and browser metadata only. Leave technical namespaces, fallback URLs, and secrets unchanged unless a deliberate migration is requested.