# Snezhanna Velichko portfolio

Clean deployment repository for the static portfolio site.

The editable source lives in the neighboring `портфолио` directory and is not
part of the deployment repository.

## Build

```bash
npm run sync
```

The command exports the four production pages, copies only referenced assets,
rewrites routes to clean URLs, and validates the final `public/` directory.

## Preview

```bash
npm run serve
```

Open `http://127.0.0.1:4173`.

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `public`
- Root directory: repository root

The Cloudflare build validates the committed `public/` directory. It does not
need access to the local editable source.

The initial `pages.dev` deployment is intentionally marked `noindex`. Remove
the scoped `X-Robots-Tag` rules from `public/_headers` and update `robots.txt`
only after a custom domain and canonical URLs are configured.
