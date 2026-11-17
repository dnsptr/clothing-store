# Admin Workspace

## Navigation

The Russian staff menu uses Medusa's built-in team sidebar layout. The release
keeps Medusa 2.22.4 and its security updates; no node_modules patches or hidden DOM
elements are used.

- `/workspace`: section directory and team navigation setup.
- `/orders`: existing native Medusa orders and order detail pages, unchanged.
  Order details retain the ТБанк fiscal refund/closing-receipt widget, operation
  history, and protected dispatch-point selection. Workspace pages do not replace
  these financial or fulfillment actions.
- `/dispatch-points`: existing warehouse-specific СДЭК and Яндекс handoff settings.
- `/catalog-editor` and `/content`: existing editors with Russian menu labels.
- Categories, collections, customers, promotions, campaigns, price lists and staff
  sections link to their existing native editors.
- Assembly, returns, stock, notifications and reports explicitly identify their
  disconnected journals. Returns and payment/delivery sections still link to the
  working order actions; a disconnected workspace journal does not mean refunds
  or shipping integrations have been removed.
- `/integrations`: real CommerceML dry-run session and file journal, including
  validation status, XML summaries and file hashes when provided by the backend.

Native technical pages remain accessible by URL and through the corresponding
workspace sections. Hiding navigation is not access control and does not grant or
revoke API permissions. The default keeps orders and dispatch settings visible.

## Applying the Menu

After building and deploying the admin, open `/app/workspace` and choose
`Применить меню магазина`. Medusa's authenticated
`POST /admin/layouts/sidebar/configuration` endpoint saves the team default and
selects it for the current user. Medusa 2.22.4 requires super-admin permission to
change this shared default. Personal layouts belonging to other users are
preserved; those users can select the default layout themselves.

Alternatively, from the backend application directory, run `npm run admin:setup`.
This replaces only the shared sidebar configuration. It does not modify products,
orders, inventory, personal layouts, payment or shipping settings. Applying the
menu is an explicit administrative operation, not an automatic migration.

The default hides duplicate native product, inventory, customer, promotion and
price-list navigation. Replacement sections retain links to the corresponding
native editors, including technical inventory, reservations and price lists.
Advanced platform settings remain available in Settings.

The extension resources set the language detector's `lng` cookie and local storage
to Russian before dashboard initialization. Core screens use Medusa's bundled
Russian translations; custom screens use Russian labels directly.

## CommerceML Dry Run

The integrations page reads `/admin/onec-exchange` with the native response shape
`{ enabled, mode: "dry_run", sessions }`. Refreshing the page only reads this
journal. The page shows whether file reception is enabled, session completion or
expiry, received file sizes, XML validation results and aggregate XML counts.
Loading errors are not presented as an empty successful journal.

Successful XML validation does not import products or update prices or stock.
Orders, reservations, ZIP archives and images are not supported by this dry-run
exchange. There are no live financial, carrier or email actions on the integrations
page. Operational payment, fiscal and dispatch actions remain in order details.

## Next Steps

1. Confirm the authoritative 1C database, allowed warehouses and stable product IDs.
2. Reconcile sanitized CommerceML samples against the dry-run journal before
   authorizing any catalog or stock writes.
3. Connect the remaining workspace journals to their real services separately.

Menu visibility must not be treated as implemented role-based authorization.
