CREATE TABLE "direct_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_chats_pair_unique" UNIQUE("group_id","user_low","user_high"),
	CONSTRAINT "direct_chats_pair_order_check" CHECK (user_low < user_high)
);
--> statement-breakpoint
ALTER TABLE "direct_chats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "direct_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"sender_id" uuid,
	"body" text NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "direct_messages_chat_client_unique" UNIQUE("chat_id","client_id"),
	CONSTRAINT "direct_messages_body_length_check" CHECK (char_length(btrim(body)) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "direct_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "direct_reads" (
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_created_at" timestamp with time zone NOT NULL,
	"read_message_id" uuid NOT NULL,
	CONSTRAINT "direct_reads_chat_id_user_id_pk" PRIMARY KEY("chat_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "direct_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "direct_chats" ADD CONSTRAINT "direct_chats_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_chats" ADD CONSTRAINT "direct_chats_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_chats" ADD CONSTRAINT "direct_chats_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_chat_id_direct_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."direct_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_reads" ADD CONSTRAINT "direct_reads_chat_id_direct_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."direct_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_reads" ADD CONSTRAINT "direct_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direct_chats_group_low_idx" ON "direct_chats" USING btree ("group_id","user_low");--> statement-breakpoint
CREATE INDEX "direct_chats_group_high_idx" ON "direct_chats" USING btree ("group_id","user_high");--> statement-breakpoint
CREATE INDEX "direct_messages_chat_created_idx" ON "direct_messages" USING btree ("chat_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);