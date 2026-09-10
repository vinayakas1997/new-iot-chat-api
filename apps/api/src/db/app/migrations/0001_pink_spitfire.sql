CREATE TABLE IF NOT EXISTS "lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lines_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "line_id" text;