import type { SupabaseClient } from "@supabase/supabase-js";

export type LinkedErrorTicket = {
  error_code: string | null;
  linked_error_event_id: string | null;
  root_cause_category: string | null;
  user_id: string | null;
};

export async function markLinkedErrorEventsResolved(
  supabase: SupabaseClient,
  ticket: LinkedErrorTicket,
  options: { resolvedAt?: string } = {},
) {
  const resolvedAt = options.resolvedAt ?? new Date().toISOString();

  if (ticket.linked_error_event_id) {
    await supabase
      .from("error_events")
      .update({ fix_required: false, resolved_at: resolvedAt })
      .eq("id", ticket.linked_error_event_id);
  }

  if (!ticket.user_id || !ticket.root_cause_category) {
    return;
  }

  let query = supabase
    .from("error_events")
    .update({ fix_required: false, resolved_at: resolvedAt })
    .eq("user_id", ticket.user_id)
    .eq("root_cause_category", ticket.root_cause_category)
    .is("resolved_at", null);

  if (ticket.error_code) {
    query = query.eq("error_code", ticket.error_code);
  }

  await query;
}
