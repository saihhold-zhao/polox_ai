# Deprecated: agent-service

Agent Lab now runs **in-process** inside the Nuxt server under `server/agent/`.

- Browser still calls `/api/agent/*`
- Sessions / runtime persist directly to SQLite (`AgentChat.runtime`)
- No separate process on `:3100`

Do not start `pnpm agent:dev`. Use `pnpm dev` only.

This directory is kept temporarily for git history; delete in a follow-up once the merge is stable.

Background generation and Agent media writes use `server/utils/localMedia.ts` and save to `.data/media`. No separate worker or cloud storage uploader is used.
