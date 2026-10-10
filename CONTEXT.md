# Tsunagu — AI Mail & Calendar

An AI-native Gmail + Google Calendar product where users manage email and scheduling primarily through chat, with direct read/write views as a secondary surface. Integrations run through Corsair.

## Language

**Memory**:
Durable facts about the user that the assistant reads before acting; written either explicitly by the user or extracted automatically by the assistant; owned, editable, and deletable by the user.
_Avoid_: profile, preferences, memory bank

**Chat**:
The primary interface where the user issues natural-language requests and the assistant drafts, summarizes, and proposes actions.
_Avoid_: assistant panel, AI sidebar

**Routine**:
A rolling seven-day list of every upcoming event on the user's calendar.
_Avoid_: agenda, schedule, timetable

**Action**:
A chronological record of an agent- or user-performed operation and its status, shown in the activity log.
_Avoid_: task, job

**Connector**:
An integration (Gmail, Google Calendar) that the user links to their account via OAuth; optional and independently toggleable.
_Avoid_: plugin

**Account**:
The user's identity and settings within the app itself — sign-in, sign-out, data deletion; distinct from any connected mailbox.
_Avoid_: profile

**Session**:
A persisted conversation in Chat, listed and resumable independently of other sessions.
_Avoid_: thread
