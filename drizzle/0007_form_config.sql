-- Custom upload form per group (slice 1). Safe on a database that already has data, and written
-- so the old app code keeps working against the new schema while the new code is not live yet.
--
-- 1. Each group gets a form configuration. The column default is the default configuration
--    (what every group had before: the four old types and an optional Subject), so the groups that
--    exist now, and any group that code unaware of the column makes later, get it with no backfill.
-- 2. Each file gets its answers: type_id, type_other and details. type_id starts empty, is
--    filled from the old columns, and only then made NOT NULL.
-- 3. A before-insert rule fills type_id and details for rows that old code inserts (it writes
--    only the old type and subject columns). It is created before the backfill so no insert can
--    slip between the two.
-- 4. The old type check is dropped with no replacement: new code writes the old type column as the
--    legacy key, or `other` for a custom type, and checks the real type_id itself. The old `type`
--    and `subject` columns stay so no data is lost; a later clean-up removes them.
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "form_config" jsonb DEFAULT '{"version":1,"types":[{"id":"notes","label":"Notes"},{"id":"pyq","label":"Previous year paper"},{"id":"study_material","label":"Study material"},{"id":"assignment","label":"Assignment"}],"fields":[{"id":"subject","label":"Subject","kind":"text","required":false}]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "type_id" text;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "type_other" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.resources_fill_answers() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF new.type_id IS NULL THEN
    new.type_id := new.type;
  END IF;
  IF new.details = '{}'::jsonb AND new.subject <> '' THEN
    new.details := jsonb_build_object('subject', new.subject);
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "resources_fill_answers" ON "resources";--> statement-breakpoint
CREATE TRIGGER "resources_fill_answers" BEFORE INSERT ON "resources" FOR EACH ROW EXECUTE FUNCTION public.resources_fill_answers();--> statement-breakpoint
UPDATE "resources" SET "type_id" = "type" WHERE "type_id" IS NULL;--> statement-breakpoint
UPDATE "resources" SET "details" = jsonb_build_object('subject', "subject") WHERE "subject" <> '' AND "details" = '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "resources" ALTER COLUMN "type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" DROP CONSTRAINT IF EXISTS "resources_type_check";--> statement-breakpoint
ALTER TABLE "resources" DROP CONSTRAINT IF EXISTS "resources_type_id_length_check";--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_type_id_length_check" CHECK (char_length(type_id) between 1 and 64);--> statement-breakpoint
ALTER TABLE "resources" DROP CONSTRAINT IF EXISTS "resources_type_other_length_check";--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_type_other_length_check" CHECK (char_length(type_other) <= 40);--> statement-breakpoint
ALTER TABLE "resources" DROP CONSTRAINT IF EXISTS "resources_details_object_check";--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_details_object_check" CHECK (jsonb_typeof(details) = 'object');
