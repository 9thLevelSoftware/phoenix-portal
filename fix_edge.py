from pathlib import Path

p = Path(r"D:\portal-wt\pr-160\supabase\functions\delete-account\index.test.ts")
t = p.read_text(encoding="utf-8")

# --- Fix R-21 Case 2: subscriptions.paddle_subscription_id is UNIQUE ---
old = """      // Case 2: a subscription id referenced by two users' rows is skipped.
      const c = await createAuthUser(admin, "shared-c");
      try {
        await must(
          "b shares subscription",
          admin.from("subscriptions").update({ paddle_subscription_id: subShared }).eq("user_id", b.id),
        );
        await must("c shares subscription", admin.from("subscriptions").insert(subscriptionRow(c.id, subShared)));
        const sharedRow = await must(
          "shared webhook",
          admin.from("paddle_webhook_events")
            .insert({ event_type: "shared-sub", paddle_subscription_id: subShared, payload: { data: {} } })
            .select("id").single(),
        );
        webhookIds.push((sharedRow.data as { id: string }).id);

        const second = await silenced(() => purgeUser(admin, c.id, fakePaddle({ status: "canceled" }).deps));
        assertEquals(second.ok, true);
        assertEquals(await eventTypes(), ["b-customer", "b-sub", "b-user", "shared-sub"]);
      } finally {
        await cleanupUsers(admin, [c.id]);
      }"""
new = """      // Case 2: subscriptions.paddle_subscription_id is UNIQUE, so two users
      // cannot share one subscription row. Purge of C still only removes
      // webhook rows that match C's own subscription id; B's rows stay.
      const c = await createAuthUser(admin, "shared-c");
      try {
        await must("c subscription", admin.from("subscriptions").insert(subscriptionRow(c.id, subShared)));
        const cWebhook = await must(
          "c webhook",
          admin.from("paddle_webhook_events")
            .insert({ event_type: "c-sub", paddle_subscription_id: subShared, payload: { data: {} } })
            .select("id").single(),
        );
        webhookIds.push((cWebhook.data as { id: string }).id);

        const second = await silenced(() => purgeUser(admin, c.id, fakePaddle({ status: "canceled" }).deps));
        assertEquals(second.ok, true);
        assertEquals(await eventTypes(), ["b-customer", "b-sub", "b-user"]);
      } finally {
        await cleanupUsers(admin, [c.id]);
      }"""
if old not in t:
    print("R-21 case2 pattern not found")
else:
    t = t.replace(old, new, 1)
    print("fixed R-21 case2")

# --- Fix residue sweep expectations for FK-cascade on sync_tombstones ---
old = """      // Delete the auth user directly, leaving the FK-less residue and the
      // avatar a failed post-delete sweep would leave.
      await must("delete user", admin.auth.admin.deleteUser(gone.id));
      const residue = await rowsReferencing(admin, gone.id);
      // (rate_limit_tracking.user_id cascades in the migrations; prod may
      // lack the FK, which is what the sweep covers there.)
      assert(residue.some((r) => r.startsWith("sync_tombstones.")), residue.join());
      assertEquals(await avatarNames(admin, gone.id), ["avatar.png"]);"""
new = """      // Seed FK-less residue explicitly so the sweep has something to remove
      // even when tables that now have FK CASCADE (sync_tombstones) clean up
      // automatically on auth.users delete.
      await must(
        "gone subscription_event",
        admin.from("subscription_events").insert({
          user_id: gone.id,
          operation: "DELETE",
          row_snapshot: {},
        }),
      );
      await must(
        "gone webhook",
        admin.from("paddle_webhook_events").insert({
          user_id: gone.id,
          event_type: "sweep-residue",
          payload: { data: {} },
        }),
      );
      // Delete the auth user directly, leaving the FK-less residue and the
      // avatar a failed post-delete sweep would leave.
      await must("delete user", admin.auth.admin.deleteUser(gone.id));
      const residue = await rowsReferencing(admin, gone.id);
      // sync_tombstones.user_id has ON DELETE CASCADE, so tombstones are gone
      // with the auth user; FK-less tables keep residue for the sweep.
      assert(residue.some((r) => r.startsWith("subscription_events.")), residue.join());
      assert(residue.some((r) => r.startsWith("paddle_webhook_events.user_id")), residue.join());
      assertEquals(await avatarNames(admin, gone.id), ["avatar.png"]);"""
if old not in t:
    print("residue pattern not found")
    idx = t.find("Delete the auth user directly")
    print(repr(t[max(0,idx-100):idx+400]) if idx>=0 else "no marker")
else:
    t = t.replace(old, new, 1)
    print("fixed residue sweep expectations")

p.write_text(t, encoding="utf-8")
print("pr160 edge tests written")
