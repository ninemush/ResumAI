import { describe, expect, test } from "vitest";

import { markLinkedErrorEventsResolved } from "@/lib/support/error-events";

type UpdateCall = {
  filters: Array<[string, string, unknown]>;
  patch: Record<string, unknown>;
  table: string;
};

function createFakeSupabase() {
  const calls: UpdateCall[] = [];

  return {
    calls,
    client: {
      from(table: string) {
        return {
          update(patch: Record<string, unknown>) {
            const call: UpdateCall = { filters: [], patch, table };

            calls.push(call);

            const chain = {
              eq(column: string, value: unknown) {
                call.filters.push(["eq", column, value]);
                return chain;
              },
              is(column: string, value: unknown) {
                call.filters.push(["is", column, value]);
                return chain;
              },
            };

            return chain;
          },
        };
      },
    },
  };
}

describe("support error event resolution", () => {
  test("clears fix-required state for linked and matching unresolved errors", async () => {
    const fake = createFakeSupabase();
    const resolvedAt = "2026-06-11T00:00:00.000Z";

    await markLinkedErrorEventsResolved(
      fake.client as never,
      {
        error_code: "MASTER_RESUME_GENERATION_FAILED",
        linked_error_event_id: "linked-error-id",
        root_cause_category: "resume_generation",
        user_id: "user-id",
      },
      { resolvedAt },
    );

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toMatchObject({
      patch: { fix_required: false, resolved_at: resolvedAt },
      table: "error_events",
    });
    expect(fake.calls[0].filters).toEqual([["eq", "id", "linked-error-id"]]);
    expect(fake.calls[1].filters).toEqual([
      ["eq", "user_id", "user-id"],
      ["eq", "root_cause_category", "resume_generation"],
      ["is", "resolved_at", null],
      ["eq", "error_code", "MASTER_RESUME_GENERATION_FAILED"],
    ]);
  });

  test("does not run broad matching updates without user and root cause", async () => {
    const fake = createFakeSupabase();

    await markLinkedErrorEventsResolved(fake.client as never, {
      error_code: null,
      linked_error_event_id: "linked-error-id",
      root_cause_category: null,
      user_id: null,
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].filters).toEqual([["eq", "id", "linked-error-id"]]);
  });
});
