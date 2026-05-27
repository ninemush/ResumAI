# Setup

Cursor is the primary development interface for this repo. Use Codex inside
Cursor for implementation work, and keep infrastructure changes documented here.

## OAuth Auth Providers

Pramania uses Supabase Auth. The app already calls these Supabase provider IDs:

- Google: `google`
- Microsoft Outlook/Hotmail: `azure`
- LinkedIn: `linkedin_oidc`

Production app callback:

```text
https://pramania.com/auth/callback
```

Local app callback:

```text
http://localhost:3000/auth/callback
```

Supabase provider callback URI to enter in Microsoft and LinkedIn:

```text
https://raqsevuqlwofhgljiazv.supabase.co/auth/v1/callback
```

### Supabase URL Configuration

In Supabase:

```text
Authentication -> URL Configuration
```

Set:

```text
Site URL: https://pramania.com
```

Redirect URLs:

```text
https://pramania.com/auth/callback
https://www.pramania.com/auth/callback
http://localhost:3000/auth/callback
http://127.0.0.1:3000/auth/callback
```

### Microsoft Outlook/Hotmail

In Microsoft Entra:

```text
Microsoft Entra ID -> App registrations -> New registration
```

Use:

```text
Name: Pramania
Supported account types: Personal Microsoft accounts and work/school accounts
Platform: Web
Redirect URI: https://raqsevuqlwofhgljiazv.supabase.co/auth/v1/callback
```

After registration:

1. Copy the Application (client) ID.
2. Create a client secret under Certificates & secrets.
3. Copy the secret `Value`, not the Secret ID.
4. In Supabase, open:

```text
Authentication -> Sign In / Providers -> Azure
```

5. Enable Azure and enter the client ID and secret.
6. Use the default tenant URL unless the app must be restricted to a specific
   Microsoft tenant.

The app requests the `email` scope for Microsoft sign-in.

### LinkedIn

In LinkedIn Developer:

```text
LinkedIn Developer Dashboard -> Create App
```

Use the Pramania company/page information and app logo.

Then:

1. Open `Products`.
2. Request `Sign In with LinkedIn using OpenID Connect`.
3. Open `Auth`.
4. Add this authorized redirect URL:

```text
https://raqsevuqlwofhgljiazv.supabase.co/auth/v1/callback
```

5. Copy the Client ID and Client Secret.
6. In Supabase, open:

```text
Authentication -> Sign In / Providers -> LinkedIn (OIDC)
```

7. Enable LinkedIn (OIDC) and enter the client ID and secret.

### Verification

After both providers are enabled:

1. Open `http://localhost:3000`.
2. Click Microsoft and complete sign-in.
3. Confirm the app returns to `/auth/callback` and then the workspace.
4. Sign out.
5. Repeat with LinkedIn.
6. In Supabase:

```text
Authentication -> Users
```

Confirm the new users/identities were created and have an email address.

