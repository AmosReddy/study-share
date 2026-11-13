CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"uploader_id" uuid,
	"title" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "resources_file_key_unique" UNIQUE("file_key"),
	CONSTRAINT "resources_type_check" CHECK (type in ('notes', 'pyq', 'study_material', 'assignment', 'other')),
	CONSTRAINT "resources_status_check" CHECK (status in ('uploading', 'ready')),
	CONSTRAINT "resources_size_check" CHECK (size_bytes > 0),
	CONSTRAINT "resources_title_length_check" CHECK (char_length(btrim(title)) between 1 and 120),
	CONSTRAINT "resources_subject_length_check" CHECK (char_length(subject) <= 60),
	CONSTRAINT "resources_file_name_length_check" CHECK (char_length(file_name) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resources_group_created_idx" ON "resources" USING btree ("group_id","created_at" DESC NULLS LAST,"id");