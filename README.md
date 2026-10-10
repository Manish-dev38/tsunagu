# Tsunagu

AI-native Gmail and Calendar: chat-first assistant with approval-gated writes, direct read/write views, and Corsair-backed Google integrations.

- Spec and tickets: [GitHub Issues](https://github.com/Manish-dev38/tsunagu/issues) (spec is #1)
- Domain vocabulary: [CONTEXT.md](./CONTEXT.md)
- Architecture decisions: [docs/adr](./docs/adr)
- Agent instructions: [AGENTS.md](./AGENTS.md)

## Develop

```bash
npm install
npm run db:generate && npm run db:migrate
cp .env.example .env   # fill AUTH_SECRET + Google OAuth credentials
npm run dev
```

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
