The browser authentication module is @netlify/identity 2.0.0, distributed through esm.sh with its browser dependencies bundled. The adjacent polyfills are esm.sh's Node compatibility modules. Their import paths have been changed to relative paths so the complete authentication client can be cached locally for offline loading. The application imports the supported @netlify/identity API only.

Sources: https://esm.sh/@netlify/identity@2.0.0/es2022/identity.bundle.mjs and https://esm.sh/node/ . Upstream license notices are retained in the distributed modules.
