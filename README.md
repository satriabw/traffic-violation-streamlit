# Traffic Violation Console

The Next.js and shadcn/ui operator console for the [traffic-violation backend](../traffic-violation). Analysts can watch a camera or video, run detection, inspect violation clips, review the evidence and discuss a violation in chat.

The application lives in [`web/`](web/README.md). It uses site-service through authenticated, same-origin routes and requires Node **26.13.0 or newer** plus **ffmpeg** on the console host.

Start the backend from its repository:

```bash
cd ../traffic-violation
docker compose up
```

Then start the console from this repository:

```bash
cd web
npm ci
cp .env.example .env.local
# Set CONSOLE_USER and a nonempty CONSOLE_PASSWORD in .env.local.
npm run dev
```

Open <http://127.0.0.1:3000> and sign in. See the [console guide](web/README.md) for production builds, environment variables, HTTPS reverse proxies, storage CORS and workflow details.

To validate changes:

```bash
cd web
npm test
npm run lint
npm run build
```

The Streamlit frontend was retired after [end-to-end acceptance](docs/acceptance/2026-11-06-nextjs-console.md). The Git tag `streamlit-final` preserves the last version containing it.
