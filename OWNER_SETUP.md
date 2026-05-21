# Owner Setup

The initial migration creates `admin_roles`, but it does not guess who the owner is.

After the first user account is created in Supabase Auth, assign owner access from the Supabase SQL editor:

```sql
insert into public.admin_roles (user_id, role)
values ('YOUR_AUTH_USER_ID', 'owner')
on conflict (user_id, role) do nothing;
```

Find `YOUR_AUTH_USER_ID` in:

```text
Supabase Dashboard -> Authentication -> Users
```

Rules:

- Only trusted owner/admin users should appear in `admin_roles`.
- Owner/admin access is required for tier configuration.
- Admin role changes should be audited once the admin console is implemented.

