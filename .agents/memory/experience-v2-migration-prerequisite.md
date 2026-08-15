---
name: Experience v2 migration prerequisite
description: The Experience v2 SQL package assumes an existing audio schema in development.
---

The Experience v2 migration sequence must not be run against a development database that lacks the base `audio_assets` relation.

**Why:** Migration 0003 creates tables that reference `audio_assets`; PostgreSQL aborts the transaction when that prerequisite is absent, so later migrations cannot safely run.

**How to apply:** Verify the development schema contains the audio base tables before retrying. Do not invent a production migration or bypass the package's transaction and environment guards.