CREATE TABLE "adaptive_score_layers" (
	"id" serial PRIMARY KEY NOT NULL,
	"score_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"layer_key" text NOT NULL,
	"family" text NOT NULL,
	"role" text DEFAULT 'stem' NOT NULL,
	"intensity_min" real DEFAULT 0 NOT NULL,
	"intensity_max" real DEFAULT 1 NOT NULL,
	"default_gain" real DEFAULT 0.5 NOT NULL,
	"sync_bars" integer DEFAULT 4 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uniq_adaptive_score_layer_key" UNIQUE("score_id","layer_key")
);

CREATE TABLE "adaptive_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"bpm" integer NOT NULL,
	"musical_key" text DEFAULT '' NOT NULL,
	"time_signature" text DEFAULT '4/4' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"added_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);

CREATE TABLE "advanced_direction_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_advanced_direction_chapter" UNIQUE("book_id","chapter_index")
);

CREATE TABLE "audio_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'music' NOT NULL,
	"source_type" text DEFAULT 'stream' NOT NULL,
	"url" text NOT NULL,
	"recipe" jsonb,
	"musical_key" text DEFAULT '' NOT NULL,
	"musical_mode" text DEFAULT '' NOT NULL,
	"brightness" real DEFAULT 0.5 NOT NULL,
	"texture" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pack_url" text DEFAULT '' NOT NULL,
	"pack_bytes" integer,
	"pack_sha256" text DEFAULT '' NOT NULL,
	"instrument_program" integer,
	"emotion" text DEFAULT 'neutral' NOT NULL,
	"bpm" integer,
	"energy" real DEFAULT 0.5 NOT NULL,
	"duration_seconds" integer,
	"loop" boolean DEFAULT true NOT NULL,
	"license" text NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "audio_event_bindings" (
	"event_key" text PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"volume" real DEFAULT 0.8 NOT NULL,
	"cooldown_ms" integer DEFAULT 70 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "audio_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_audio_favorite" UNIQUE("user_id","asset_id")
);

CREATE TABLE "audiobook_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"speech_profile_revision" integer NOT NULL,
	"content_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"storage_key" text DEFAULT '' NOT NULL,
	"mime_type" text DEFAULT 'audio/mpeg' NOT NULL,
	"duration_seconds" integer,
	"character_count" integer NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audiobook_cache_cache_key_unique" UNIQUE("cache_key")
);

CREATE TABLE "audiobook_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_key" text NOT NULL,
	"cache_key" text NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"speech_profile_revision" integer NOT NULL,
	"content_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"estimated_paper" integer NOT NULL,
	"reserved_paper" integer NOT NULL,
	"expected_characters" integer NOT NULL,
	"actual_characters" integer DEFAULT 0 NOT NULL,
	"provider" text DEFAULT 'elevenlabs' NOT NULL,
	"error_code" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	CONSTRAINT "audiobook_jobs_request_key_unique" UNIQUE("request_key")
);

CREATE TABLE "author_earnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_user_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"author_cents" integer DEFAULT 0 NOT NULL,
	"platform_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'mxn' NOT NULL,
	"status" text DEFAULT 'accrued' NOT NULL,
	"payout_eligible" boolean DEFAULT false NOT NULL,
	"payout_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "author_earnings_order_id_unique" UNIQUE("order_id")
);

CREATE TABLE "author_payout_accounts" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_account_id" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'mxn' NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"transfers_active" boolean DEFAULT false NOT NULL,
	"disabled_reason" text DEFAULT '' NOT NULL,
	"requirements_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "author_payout_accounts_provider_account_id_unique" UNIQUE("provider_account_id")
);

CREATE TABLE "author_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_user_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'mxn' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_ref" text DEFAULT '' NOT NULL,
	"failure_code" text DEFAULT '' NOT NULL,
	"admin_user_id" integer,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "author_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_key" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '',
	"avatar" text DEFAULT '',
	"banner" text DEFAULT '',
	"frame" text DEFAULT '',
	"social_links" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "author_profiles_name_key_unique" UNIQUE("name_key")
);

CREATE TABLE "book_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer,
	"author_id" integer,
	"rarity" text DEFAULT 'common' NOT NULL,
	"in_gacha_pool" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"fx" jsonb DEFAULT '{}'::jsonb,
	"unlock_mode" text DEFAULT 'support' NOT NULL,
	"price_tinta" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "book_drafts" (
	"book_id" integer PRIMARY KEY NOT NULL,
	"author_id" integer NOT NULL,
	"base_revision" integer NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "book_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_type" text DEFAULT 'update' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "book_revisions_book_revision_unique" UNIQUE("book_id","revision")
);

CREATE TABLE "book_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"book_id" integer NOT NULL,
	"owner_user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "books" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"author_id" integer,
	"cover_url" text DEFAULT '' NOT NULL,
	"cover_fx" jsonb DEFAULT '{"mode":"simple","layers":{"back":"","mid":"","front":""}}'::jsonb,
	"content" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"chapters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"type" text DEFAULT 'book' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"gacha_score" real DEFAULT 0 NOT NULL,
	"rarity_ceiling" text DEFAULT 'common' NOT NULL,
	"is_classic" boolean DEFAULT false NOT NULL,
	"banner_url" text DEFAULT '',
	"publication_year" integer,
	"original_language" text DEFAULT '',
	"gutenberg_id" integer,
	"spotify_link" text DEFAULT '',
	"back_cover_url" text DEFAULT '',
	"premium_cover_url" text DEFAULT '',
	"premium_back_url" text DEFAULT '',
	"is_saved" boolean DEFAULT false NOT NULL,
	"is_authored" boolean DEFAULT false NOT NULL,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "chapter_audio_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"volume" real DEFAULT 0.35 NOT NULL,
	"loop" boolean DEFAULT true NOT NULL,
	"crossfade_seconds" real DEFAULT 6 NOT NULL,
	"assigned_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_book_chapter_audio" UNIQUE("book_id","chapter_index")
);

CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer DEFAULT 0 NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"user_avatar" text DEFAULT '',
	"content" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "direction_agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_key" text NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"content_hash" text NOT NULL,
	"mode" text DEFAULT 'replace_unlocked' NOT NULL,
	"status" text DEFAULT 'quoted' NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"estimated_input_units" integer NOT NULL,
	"estimated_output_units" integer NOT NULL,
	"estimated_paper" integer NOT NULL,
	"maximum_paper" integer NOT NULL,
	"reserved_paper" integer DEFAULT 0 NOT NULL,
	"actual_input_units" integer DEFAULT 0 NOT NULL,
	"actual_output_units" integer DEFAULT 0 NOT NULL,
	"charged_paper" integer DEFAULT 0 NOT NULL,
	"proposal" jsonb,
	"error_code" text DEFAULT '' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	CONSTRAINT "direction_agent_runs_request_key_unique" UNIQUE("request_key")
);

CREATE TABLE "experience_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_project_revision" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"data" jsonb NOT NULL,
	"compiled_by" integer,
	"compiled_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	CONSTRAINT "uniq_experience_profile_chapter" UNIQUE("book_id","chapter_index")
);

CREATE TABLE "frames" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_tinta" integer DEFAULT 0 NOT NULL,
	"target" text DEFAULT 'both' NOT NULL,
	"schema_version" text DEFAULT '1.0.0' NOT NULL,
	"fingerprint" text DEFAULT '',
	"pkg" jsonb NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "gacha_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"pool_balance" integer DEFAULT 0 NOT NULL,
	"ticket_price" integer DEFAULT 10 NOT NULL,
	"split_direct" integer DEFAULT 3 NOT NULL,
	"split_pool" integer DEFAULT 4 NOT NULL,
	"split_house" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "gacha_draws" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"card_id" integer,
	"book_id" integer,
	"author_id" integer,
	"rarity" text NOT NULL,
	"rolled_rarity" text NOT NULL,
	"reason" text NOT NULL,
	"ticket_price" integer NOT NULL,
	"paid_direct" integer NOT NULL,
	"paid_pool" integer NOT NULL,
	"paid_house" integer NOT NULL,
	"bonus_from_pool" integer NOT NULL,
	"pool_before" integer NOT NULL,
	"pool_after" integer NOT NULL,
	"was_duplicate" boolean DEFAULT false NOT NULL,
	"paper_granted" integer DEFAULT 0 NOT NULL,
	"book_granted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "gacha_exclusions" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"genres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "gacha_pity" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"since_golden" integer DEFAULT 0 NOT NULL,
	"since_legendary" integer DEFAULT 0 NOT NULL,
	"total_draws" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "narrative_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_narrative_project_chapter" UNIQUE("book_id","chapter_index")
);

CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text DEFAULT 'system' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"dedupe_key" text DEFAULT '' NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "paper_usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"request_key" text NOT NULL,
	"feature" text NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"input_units" integer DEFAULT 0 NOT NULL,
	"output_units" integer DEFAULT 0 NOT NULL,
	"paper_charged" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paper_usage_events_request_key_unique" UNIQUE("request_key")
);

CREATE TABLE "print_copies" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer NOT NULL,
	"folio" text NOT NULL,
	"claim_key" text NOT NULL,
	"claim_key_hash" text DEFAULT '' NOT NULL,
	"claimed_by_user_id" integer,
	"claimed_at" timestamp,
	"sale_status" text DEFAULT 'available' NOT NULL,
	"sold_at" timestamp,
	"sale_price_cents" integer,
	"sale_channel" text DEFAULT '' NOT NULL,
	"sale_note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "print_copies_folio_unique" UNIQUE("folio")
);

CREATE TABLE "print_copy_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"copy_id" integer NOT NULL,
	"actor_user_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "reading_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" text NOT NULL,
	"chapter" integer DEFAULT 0 NOT NULL,
	"max_chapter" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_user_book" UNIQUE("user_id","book_id")
);

CREATE TABLE "saved_books" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_user_saved" UNIQUE("user_id","book_id")
);

CREATE TABLE "speech_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_project_revision" integer NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"character_count" integer NOT NULL,
	"data" jsonb NOT NULL,
	"compiled_by" integer,
	"compiled_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	CONSTRAINT "uniq_speech_profile_chapter" UNIQUE("book_id","chapter_index")
);

CREATE TABLE "speech_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_speech_project_chapter" UNIQUE("book_id","chapter_index")
);

CREATE TABLE "token_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'mxn' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'beta' NOT NULL,
	"provider_ref" text DEFAULT '',
	"payment_ref" text DEFAULT '',
	"refund_ref" text DEFAULT '',
	"token_id" integer,
	"author_user_id" integer,
	"author_share_bps" integer DEFAULT 0 NOT NULL,
	"book_type_snapshot" text DEFAULT '' NOT NULL,
	"book_revision_snapshot" integer DEFAULT 1 NOT NULL,
	"cash_backing_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"refunded_at" timestamp
);

CREATE TABLE "unlocked_books" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"source" text DEFAULT 'support' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_user_unlocked" UNIQUE("user_id","book_id")
);

CREATE TABLE "user_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"card_id" integer NOT NULL,
	"source" text DEFAULT 'support' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_user_card" UNIQUE("user_id","card_id")
);

CREATE TABLE "user_frames" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"frame_id" integer NOT NULL,
	"source" text DEFAULT 'tinta' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_user_frame" UNIQUE("user_id","frame_id")
);

CREATE TABLE "user_state" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"streak_days" integer DEFAULT 0 NOT NULL,
	"streak_last_date" text DEFAULT '',
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"google_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text DEFAULT '',
	"bio" text DEFAULT '',
	"social_links" jsonb DEFAULT '{}'::jsonb,
	"frame" text DEFAULT '',
	"custom_avatar" boolean DEFAULT false NOT NULL,
	"banner" text DEFAULT '',
	"subscription_plan" text DEFAULT 'reader' NOT NULL,
	"subscription_status" text DEFAULT 'inactive' NOT NULL,
	"subscription_expires_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "voice_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT 'elevenlabs' NOT NULL,
	"provider_voice_id" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"role" text DEFAULT 'both' NOT NULL,
	"license" text NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_voice_provider_id" UNIQUE("provider","provider_voice_id")
);

CREATE TABLE "wallet_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"currency" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text DEFAULT '',
	"ref_id" integer,
	"cash_backing_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "wallet_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"currency" text DEFAULT 'tinta' NOT NULL,
	"amount" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'beta' NOT NULL,
	"provider_ref" text DEFAULT '',
	"payment_ref" text DEFAULT '',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);

CREATE TABLE "payment_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_object_id" text NOT NULL,
	"kind" text NOT NULL,
	"payment_ref" text DEFAULT '' NOT NULL,
	"token_order_id" integer,
	"wallet_order_id" integer,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'mxn' NOT NULL,
	"provider_status" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"resolution" text DEFAULT 'open' NOT NULL,
	"resolution_note" text DEFAULT '' NOT NULL,
	"admin_user_id" integer,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_incidents_provider_event_id_unique" UNIQUE("provider_event_id"),
	CONSTRAINT "payment_incidents_provider_object_id_unique" UNIQUE("provider_object_id")
);

ALTER TABLE "adaptive_score_layers" ADD CONSTRAINT "adaptive_score_layers_score_id_adaptive_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."adaptive_scores"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "adaptive_score_layers" ADD CONSTRAINT "adaptive_score_layers_asset_id_audio_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "adaptive_scores" ADD CONSTRAINT "adaptive_scores_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "advanced_direction_projects" ADD CONSTRAINT "advanced_direction_projects_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "advanced_direction_projects" ADD CONSTRAINT "advanced_direction_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audio_event_bindings" ADD CONSTRAINT "audio_event_bindings_asset_id_audio_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audio_event_bindings" ADD CONSTRAINT "audio_event_bindings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audio_favorites" ADD CONSTRAINT "audio_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audio_favorites" ADD CONSTRAINT "audio_favorites_asset_id_audio_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audiobook_cache" ADD CONSTRAINT "audiobook_cache_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audiobook_jobs" ADD CONSTRAINT "audiobook_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audiobook_jobs" ADD CONSTRAINT "audiobook_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "author_earnings" ADD CONSTRAINT "author_earnings_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "author_earnings" ADD CONSTRAINT "author_earnings_order_id_token_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."token_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "author_earnings" ADD CONSTRAINT "author_earnings_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "author_earnings" ADD CONSTRAINT "author_earnings_payout_id_author_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."author_payouts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "author_payout_accounts" ADD CONSTRAINT "author_payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "author_payouts" ADD CONSTRAINT "author_payouts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "author_payouts" ADD CONSTRAINT "author_payouts_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_cards" ADD CONSTRAINT "book_cards_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_cards" ADD CONSTRAINT "book_cards_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_drafts" ADD CONSTRAINT "book_drafts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_drafts" ADD CONSTRAINT "book_drafts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_tokens" ADD CONSTRAINT "book_tokens_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "book_tokens" ADD CONSTRAINT "book_tokens_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "books" ADD CONSTRAINT "books_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chapter_audio_assignments" ADD CONSTRAINT "chapter_audio_assignments_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chapter_audio_assignments" ADD CONSTRAINT "chapter_audio_assignments_asset_id_audio_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chapter_audio_assignments" ADD CONSTRAINT "chapter_audio_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "comments" ADD CONSTRAINT "comments_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "direction_agent_runs" ADD CONSTRAINT "direction_agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "direction_agent_runs" ADD CONSTRAINT "direction_agent_runs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "experience_profiles" ADD CONSTRAINT "experience_profiles_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "experience_profiles" ADD CONSTRAINT "experience_profiles_compiled_by_users_id_fk" FOREIGN KEY ("compiled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "frames" ADD CONSTRAINT "frames_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gacha_draws" ADD CONSTRAINT "gacha_draws_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gacha_draws" ADD CONSTRAINT "gacha_draws_card_id_book_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."book_cards"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gacha_draws" ADD CONSTRAINT "gacha_draws_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gacha_draws" ADD CONSTRAINT "gacha_draws_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gacha_exclusions" ADD CONSTRAINT "gacha_exclusions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gacha_pity" ADD CONSTRAINT "gacha_pity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "narrative_projects" ADD CONSTRAINT "narrative_projects_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "narrative_projects" ADD CONSTRAINT "narrative_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "paper_usage_events" ADD CONSTRAINT "paper_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "print_copies" ADD CONSTRAINT "print_copies_token_id_book_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."book_tokens"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "print_copies" ADD CONSTRAINT "print_copies_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "print_copy_events" ADD CONSTRAINT "print_copy_events_copy_id_print_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."print_copies"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "print_copy_events" ADD CONSTRAINT "print_copy_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "saved_books" ADD CONSTRAINT "saved_books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "saved_books" ADD CONSTRAINT "saved_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "speech_profiles" ADD CONSTRAINT "speech_profiles_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "speech_profiles" ADD CONSTRAINT "speech_profiles_compiled_by_users_id_fk" FOREIGN KEY ("compiled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "speech_projects" ADD CONSTRAINT "speech_projects_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "speech_projects" ADD CONSTRAINT "speech_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "token_orders" ADD CONSTRAINT "token_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "token_orders" ADD CONSTRAINT "token_orders_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "token_orders" ADD CONSTRAINT "token_orders_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "unlocked_books" ADD CONSTRAINT "unlocked_books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "unlocked_books" ADD CONSTRAINT "unlocked_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_card_id_book_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."book_cards"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_frames" ADD CONSTRAINT "user_frames_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_frames" ADD CONSTRAINT "user_frames_frame_id_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."frames"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_state" ADD CONSTRAINT "user_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "wallet_orders" ADD CONSTRAINT "wallet_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_incidents" ADD CONSTRAINT "payment_incidents_token_order_id_token_orders_id_fk" FOREIGN KEY ("token_order_id") REFERENCES "public"."token_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_incidents" ADD CONSTRAINT "payment_incidents_wallet_order_id_wallet_orders_id_fk" FOREIGN KEY ("wallet_order_id") REFERENCES "public"."wallet_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_incidents" ADD CONSTRAINT "payment_incidents_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
