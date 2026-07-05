# Wardley Kit

Wardley Kit is a standalone Wardley map parser, SVG renderer, browser preview, and validation toolkit extracted from `structurizr4js`.

It intentionally does not include the old Canvas integration or PPTX export path. The deployable preview is built as static files under `dist/` for GitHub Pages.

## Usage

```sh
npm install
npm run preview
```

Then open the local URL printed by the preview server.

## Checks

```sh
npm run check
```

This runs TypeScript build, unit tests, static preview build, and the preview verification suite.

## GitHub Pages

Pushes to `main` run `.github/workflows/pages.yml`. The workflow builds the preview and publishes `dist/` to GitHub Pages.
