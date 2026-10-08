CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "auth"."auth_event_type" AS ENUM('signup', 'email_verified', 'login_password_ok', 'login_failed', 'otp_sent', 'otp_failed', 'login_success', 'refresh', 'refresh_reuse_detected', 'logout', 'session_revoked', 'password_reset_requested', 'password_reset', 'rate_limited');--> statement-breakpoint
CREATE TYPE "auth"."login_method" AS ENUM('password_otp', 'password', 'email_verify');--> statement-breakpoint
CREATE TYPE "auth"."otp_purpose" AS ENUM('email_verify', 'login', 'password_reset');--> statement-breakpoint
CREATE TYPE "auth"."session_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "auth"."user_role" AS ENUM('customer', 'admin');--> statement-breakpoint
CREATE TYPE "auth"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "auth"."auth_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"email" text,
	"type" "auth"."auth_event_type" NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"geo_country" text,
	"geo_city" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"purpose" "auth"."otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"send_count" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"device" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"login_method" "auth"."login_method" NOT NULL,
	"status" "auth"."session_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"created_ip" "inet",
	"last_ip" "inet",
	"user_agent" text,
	"device_type" text,
	"device_name" text,
	"os" text,
	"browser" text,
	"client_platform" text,
	"app_version" text,
	"client_device_id" text,
	"geo_country_code" text,
	"geo_country" text,
	"geo_region" text,
	"geo_city" text,
	"geo_lat" double precision,
	"geo_lon" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "auth"."user_role" DEFAULT 'customer' NOT NULL,
	"status" "auth"."user_status" DEFAULT 'active' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT true NOT NULL,
	"password_changed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_user_created_idx" ON "auth"."auth_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "otp_challenges_email_purpose_idx" ON "auth"."otp_challenges" USING btree ("email","purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "auth"."refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_session_idx" ON "auth"."refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessions_user_status_idx" ON "auth"."sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "auth"."users" USING btree ("email");