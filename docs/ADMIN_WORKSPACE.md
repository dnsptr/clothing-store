# Admin Workspace

## Navigation

The Russian staff menu is configured using Medusa 2.17.2's built-in team sidebar
layout. No patches to node_modules or hidden DOM elements are used.

- `/workspace`: section directory and navigation setup.
- `/orders`: existing Medusa orders, unchanged.
- `/catalog-editor` and `/content`: existing editors, unchanged apart from labels.
- Categories, collections, customers, promotions and staff sections link to
  existing native editors.
- Assembly, returns, stock, notifications, reports and integrations have explicitly
  disconnected states. They do not fabricate records, metrics or integration health.

Native technical pages remain accessible by URL. Hiding navigation is not access
control and does not grant or revoke API permissions.

## Applying the Menu

After building and deploying the admin, open `/app/workspace` and choose
`Применить меню магазина`. The authenticated Medusa endpoint saves the team default
and selects it for the current user. Personal layouts belonging to other users
are preserved; those users can select the default layout themselves.

Alternatively, from the backend application directory, run `npm run admin:setup`.
This replaces only the shared sidebar configuration. It does not modify products,
orders, inventory, personal layouts, payment or shipping settings.

The default hides duplicate native product, inventory, customer, promotion and
price-list navigation. Their replacement sections retain links to needed editors.
Advanced platform settings remain available in Settings.

The extension resources set the language detector's `lng` cookie and local storage
to Russian before dashboard initialization. Core screens use Medusa's bundled
Russian translations; custom screens use Russian labels directly.

## Next Steps

1. Identify the authoritative 1C database, warehouses and stable product IDs.
2. Agree on exchange format and obtain a small sanitized sample.
3. Add a dry-run import and reconciliation report before enabling stock updates.
4. Replace disconnected workspace states with real services one section at a time.

Menu visibility must not be treated as implemented role-based authorization.
