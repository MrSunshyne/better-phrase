# Better Phrase

A web app to interact with the Phrase API in a more developer-friendly way.

## Features

- Search and browse translation keys
- Copy keys in JSON format for quick editing
- Bulk import/update translations with diff preview
- Word-level diff for translation changes
- Editor content persists across sessions

## Setup

```bash
pnpm install
pnpm dev
```

## Usage

1. Enter your Phrase API token
2. Select a project
3. Choose the languages you want to work with
4. Search for keys or add new ones

## Deploy

Built as a static SPA. Deploy to Cloudflare Pages:

```bash
pnpm generate
```

Output: `.output/public`
