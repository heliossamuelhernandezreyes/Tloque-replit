-- Los snapshots generados desde Drizzle crean columnas, claves y relaciones,
-- pero las validaciones SQL históricas viven en migraciones manuales. Esta
-- capa hace explícitos esos contratos tanto para bases nuevas como existentes.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_kind_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_kind_check
      CHECK (kind IN ('music', 'ambience', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_bpm_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_bpm_check
      CHECK (bpm IS NULL OR bpm BETWEEN 20 AND 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_energy_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_energy_check
      CHECK (energy BETWEEN 0 AND 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_assets_duration_check') THEN
    ALTER TABLE audio_assets ADD CONSTRAINT audio_assets_duration_check
      CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chapter_audio_index_check') THEN
    ALTER TABLE chapter_audio_assignments ADD CONSTRAINT chapter_audio_index_check
      CHECK (chapter_index >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chapter_audio_volume_check') THEN
    ALTER TABLE chapter_audio_assignments ADD CONSTRAINT chapter_audio_volume_check
      CHECK (volume BETWEEN 0 AND 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chapter_audio_crossfade_check') THEN
    ALTER TABLE chapter_audio_assignments ADD CONSTRAINT chapter_audio_crossfade_check
      CHECK (crossfade_seconds BETWEEN 0.25 AND 20);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adaptive_scores_bpm_check') THEN
    ALTER TABLE adaptive_scores ADD CONSTRAINT adaptive_scores_bpm_check CHECK (bpm BETWEEN 20 AND 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adaptive_scores_status_check') THEN
    ALTER TABLE adaptive_scores ADD CONSTRAINT adaptive_scores_status_check
      CHECK (status IN ('draft', 'published', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adaptive_layers_family_check') THEN
    ALTER TABLE adaptive_score_layers ADD CONSTRAINT adaptive_layers_family_check
      CHECK (family IN ('base', 'harmony', 'melody', 'bass', 'texture', 'percussion', 'ambience'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adaptive_layers_role_check') THEN
    ALTER TABLE adaptive_score_layers ADD CONSTRAINT adaptive_layers_role_check
      CHECK (role IN ('stem', 'loop', 'transition'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adaptive_layers_values_check') THEN
    ALTER TABLE adaptive_score_layers ADD CONSTRAINT adaptive_layers_values_check CHECK (
      intensity_min BETWEEN 0 AND 1 AND intensity_max BETWEEN 0 AND 1
      AND intensity_min <= intensity_max AND default_gain BETWEEN 0 AND 1
      AND sync_bars BETWEEN 1 AND 64
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'narrative_project_values_check') THEN
    ALTER TABLE narrative_projects ADD CONSTRAINT narrative_project_values_check
      CHECK (chapter_index >= 0 AND revision >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_profile_values_check') THEN
    ALTER TABLE experience_profiles ADD CONSTRAINT experience_profile_values_check CHECK (
      chapter_index >= 0 AND revision >= 1 AND source_project_revision >= 1
      AND status IN ('draft', 'approved')
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_profiles_contract_check') THEN
    ALTER TABLE voice_profiles ADD CONSTRAINT voice_profiles_contract_check CHECK (
      provider = 'elevenlabs'
      AND role IN ('narrator', 'dialogue', 'both')
      AND status IN ('draft', 'published', 'archived')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'speech_projects_contract_check') THEN
    ALTER TABLE speech_projects ADD CONSTRAINT speech_projects_contract_check
      CHECK (chapter_index >= 0 AND revision >= 1 AND content_hash ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'speech_profiles_contract_check') THEN
    ALTER TABLE speech_profiles ADD CONSTRAINT speech_profiles_contract_check CHECK (
      chapter_index >= 0 AND revision >= 1 AND source_project_revision >= 1
      AND content_hash ~ '^[a-f0-9]{64}$' AND status IN ('draft', 'approved')
      AND character_count > 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audiobook_cache_contract_check') THEN
    ALTER TABLE audiobook_cache ADD CONSTRAINT audiobook_cache_contract_check CHECK (
      cache_key ~ '^[a-f0-9]{64}$' AND chapter_index >= 0
      AND speech_profile_revision >= 1 AND content_hash ~ '^[a-f0-9]{64}$'
      AND character_count > 0 AND status IN ('generating', 'ready', 'failed', 'retired')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audiobook_jobs_contract_check') THEN
    ALTER TABLE audiobook_jobs ADD CONSTRAINT audiobook_jobs_contract_check CHECK (
      cache_key ~ '^[a-f0-9]{64}$' AND chapter_index >= 0
      AND speech_profile_revision >= 1 AND content_hash ~ '^[a-f0-9]{64}$'
      AND status IN ('queued', 'processing', 'ready', 'failed')
      AND estimated_paper >= 0 AND reserved_paper >= 0
      AND expected_characters > 0 AND actual_characters >= 0
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advanced_direction_contract_check') THEN
    ALTER TABLE advanced_direction_projects ADD CONSTRAINT advanced_direction_contract_check
      CHECK (chapter_index >= 0 AND revision >= 1 AND content_hash ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direction_runs_contract_check') THEN
    ALTER TABLE direction_agent_runs ADD CONSTRAINT direction_runs_contract_check CHECK (
      chapter_index >= 0 AND content_hash ~ '^[a-f0-9]{64}$'
      AND mode IN ('replace_unlocked', 'fill_gaps')
      AND status IN ('quoted', 'processing', 'ready', 'applied', 'failed', 'expired')
      AND estimated_input_units >= 0 AND estimated_output_units >= 0
      AND estimated_paper >= 0 AND maximum_paper >= estimated_paper
      AND reserved_paper >= 0 AND actual_input_units >= 0
      AND actual_output_units >= 0 AND charged_paper >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audio_event_bindings_contract_check') THEN
    ALTER TABLE audio_event_bindings ADD CONSTRAINT audio_event_bindings_contract_check
      CHECK (volume BETWEEN 0 AND 1 AND cooldown_ms BETWEEN 0 AND 10000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_revisions_contract_check') THEN
    ALTER TABLE book_revisions ADD CONSTRAINT book_revisions_contract_check CHECK (
      revision >= 1 AND change_type IN ('create', 'update', 'publish', 'unpublish', 'restore', 'delete')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_drafts_contract_check') THEN
    ALTER TABLE book_drafts ADD CONSTRAINT book_drafts_contract_check
      CHECK (base_revision >= 1 AND draft_revision >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_rate_limits_count_check') THEN
    ALTER TABLE api_rate_limits ADD CONSTRAINT api_rate_limits_count_check CHECK (request_count >= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'author_payout_accounts_contract_check') THEN
    ALTER TABLE author_payout_accounts ADD CONSTRAINT author_payout_accounts_contract_check CHECK (
      provider = 'stripe' AND jsonb_typeof(requirements_due) = 'array'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'author_payouts_contract_check') THEN
    ALTER TABLE author_payouts ADD CONSTRAINT author_payouts_contract_check CHECK (
      amount_cents > 0 AND currency = 'mxn' AND provider = 'stripe'
      AND status IN (
        'requested', 'processing', 'processing_unknown', 'transferred',
        'failed', 'rejected', 'reversed', 'attention'
      )
    );
  END IF;
END $$;
