# Approval-gated agent architecture

The AI agent operates as an OpenAI-compatible tool-calling loop over Corsair's Gmail and Google Calendar APIs: reads and draft-creation run freely, but every outbound write — sending an email, creating a calendar event or invite, or any bulk mailbox mutation — must pass through an editable approval card (Approve / Edit / Discard) in Chat before execution. We chose this over full autonomy because a wrong recipient or meeting time is an embarrassing, hard-to-take-back failure, while scripted flows (fixed command templates instead of an agent) would defeat the product's AI-native, natural-language premise. Human-initiated actions from the direct read/write views bypass the gate entirely: the user performing the action *is* the approval.

## Considered Options

- **Full autonomy** — agent sends when it judges appropriate. Rejected: irreversible mistakes with the user's own identity attached; users do not trust it.
- **Scripted command flows** — NLP parsed into fixed intents, no free-form agent. Rejected: brittle parsing, no summarization or multi-step reasoning, not AI-native.
- **Approval gates (chosen)** — read/draft freely, gate all agent writes; direct human actions ungated.

tRPC sits at the client-server boundary; the UI is a thin shell and stays untested at the router seam.

## Consequences

- Every agent write path must route through the approval card; a "send now" tool that skips the gate would violate the decision.
- The Action log becomes the audit trail for gated operations and the surface for undo where still possible.
- Two write pipelines exist by design (agent-gated vs direct-ungated); unifying them later would be a regression, not a cleanup.
