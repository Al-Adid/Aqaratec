# Run locally
pnpm install
pnpm dev:static        # open the printed URL, then "Open the local guest workspace"

Windows PowerShell:
$env:VITE_EXPLICIT_LOCAL_GUEST=1; npx vite

# Netlify
Build command: pnpm build:static
Publish directory: dist/public
(netlify.toml in the project already sets this.)
