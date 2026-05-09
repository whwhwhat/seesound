# GitHub Pages Deployment

The public web entry is intended to be:

[https://whwhwhat.github.io/seesound/](https://whwhwhat.github.io/seesound/)

## How It Works

The workflow in [`../../.github/workflows/pages.yml`](../../.github/workflows/pages.yml):

1. Checks out the repository.
2. Installs web dependencies in `audio-reactive-video/web`.
3. Runs `npm run build`.
4. Uploads `audio-reactive-video/web/dist`.
5. Deploys that artifact to GitHub Pages.

The Vite config uses `base: "./"` so the generated asset paths work under the project page path instead of assuming the site is hosted at the domain root.

## Repository Setup

In GitHub:

1. Open repository **Settings**.
2. Open **Pages**.
3. Set **Build and deployment** source to **GitHub Actions**.
4. Push to `main` or `dev_web_gpu`.

If you later want only the default branch to publish the public app, remove `dev_web_gpu` from the workflow trigger.

## Local Verification

```bash
cd audio-reactive-video/web
npm run build
npm run preview
```

The preview server tests the production build locally, but it does not test GitHub Pages permissions or repository settings.
