import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const quotaEventSchema = z.object({
  amount: z.number().int().positive().default(1),
  eventType: z.enum(["application_logged", "generation_created", "manual_adjustment"]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  resourceId: z.string().uuid(),
  resourceType: z.string().min(1).max(120),
});

export async function recordQuotaEvent(input: z.input<typeof quotaEventSchema>) {
  const parsed = quotaEventSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_quota_event", {
    p_amount: parsed.amount,
    p_event_type: parsed.eventType,
    p_metadata: parsed.metadata,
    p_resource_id: parsed.resourceId,
    p_resource_type: parsed.resourceType,
  });

  if (error || !data) {
    throw new Error("QUOTA_EVENT_RECORD_FAILED");
  }

  return data as string;
}
