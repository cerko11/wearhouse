WearHouse cloud accounts

WearHouse uses Netlify Identity for accounts and verified email recovery, Netlify Database for wardrobe records, and private Netlify Blobs for photos. Passwords are handled by Identity and never copied into wardrobe records. No external database project or client API credentials are required.

New users register, confirm their email, and log in from the same site URL on any browser. Existing browser-only users must register and confirm the same email on the browser containing their old wardrobe. That verified login imports local records that do not already exist remotely; old local password hashes are removed from the imported account. Existing local passwords are not automatically cloud credentials.

Each account has its own localStorage cache and pending changes. Changes sync after saving, on login, on reconnect, on window focus, and every 30 seconds while visible. Cached photos and records remain available offline after a successful sync. A new login or password reset needs connectivity. Local caching depends on available browser storage.

Items, outfits, and posts sync independently, preserving unrelated changes from different devices. Deletions are retained as tombstones. If two devices edit the same record, the last write received by the server wins. Profile changes merge only edited fields into each account’s dedicated userProfile cloud document; styling settings sync as a whole record. Account IDs keep profiles attached to the same login even when handles change. Followers are derived from the cloud following lists. Visible pages poll the profiles endpoint every second and refresh on focus/reconnect, without a hard refresh. This is polling rather than a push subscription. Avatar references remain valid across devices and later profile edits. Browser storage holds only the offline cache and upload queue for these cloud records.

Database migrations are applied by the deployment platform. The automated tests simulate independent browser caches and cloud responses; live email delivery and database provisioning require deployment. Run `npm test` for the sync and endpoint authorization checks.

The Capacitor shell loads the hosted HTTPS site so native Android, mobile browsers, and desktop browsers all use the same Identity and sync endpoints. Existing Android installations need an updated native package generated with the revised Capacitor configuration. The hosted site must be deployed before using that package.

### Admin moderation

Admin access is granted automatically when the authenticated login email matches
`ADMIN_EMAILS` in index.html and netlify/functions/lib/admin.mts. The configured
administrator is cerko11real@gmail.com. Matching ignores capitalization and outer
whitespace. Keep both allowlists and the mobile HTML copy aligned when changing
administrators. No Identity dashboard role assignment is required. The app assigns
`isAdmin` and `role` for display, while the server independently checks the email
from the authenticated Identity session. Browser flags and Identity roles do not
grant server privileges. Existing accounts use the same login and confirmation flow.

Admins can verify members, remove any post or comment, ban accounts, and permanently
delete accounts from public profiles or community search results. Verification and
moderation tombstones use protected records in the existing Netlify Database table.
Users cannot change those records through wardrobe synchronization. Bans reject
existing sessions at API endpoints and hide the account's community content. Account
deletion also removes the Identity account and clears its application records;
previously uploaded image objects may remain inaccessible in private object storage.
Tab and view preferences remain per account and per device in the local cache.
