# SyncGate 🔁

> **AI proposes, humans dispose.** A deterministic Human-in-the-Loop staging area for CRM data.

---

## The Problem

Sales reps spend **30% of their day** manually copying meeting notes into Salesforce/HubSpot. The result:
- **Manual entry** → reps skip it or do it wrong, corrupting pipeline data
- **Direct AI automation** → LLMs hallucinate deal amounts and wrong pipeline stages, destroying records
- **The chatbot trap** → current AI tools just output a bullet list; reps still have to copy-paste manually

## The Solution

SyncGate bridges the gap with a **Deterministic Human-in-the-Loop Workflow**:

```
Raw Notes → AI Extracts → Human Reviews & Corrects → Safe CRM Commit
```

Instead of letting AI run wild or forcing humans to do all the work, SyncGate uses AI for **speed** and humans for **judgment**.

---

## How It Works

### Step 1: Input
Paste any unstructured meeting notes, call transcript, or Slack summary.

### Step 2: AI Extraction
`anna.llm.complete()` sends the notes to the LLM with a strict schema prompt:
- Returns **only** a clean JSON object
- Uses `null` for missing values (no hallucination)
- Strips currency symbols from deal amounts

### Step 3: Staging Area & Human Review
The AI's JSON output **populates an editable React form** — not a chat bubble.
- 🟡 **Amber-highlighted fields** = AI-generated (needs review)
- **Confidence score & Reasoning** shows exactly *why* the AI extracted a specific value
- **Per-field Re-extract**: Click ↻ on any field to ask the AI to try again with a specific hint

### Step 4: Ask AI (Multi-turn Chat)
Need to clarify something in the notes? Open the **Ask AI Sidebar**.
- Conversational interface directly tied to the current extraction
- Ask the AI to identify risks, suggest deal stages, or explain its logic

### Step 5: Approve & Sync
Human clicks **"Approve & Sync to CRM"** → safe, verified data commits to Salesforce.
- Anna writes a summary message to the chat log
- Full audit trail: which fields were human-corrected vs AI-proposed

---

## Anna Platform Integration

| Feature | Usage |
|---|---|
| `anna.llm.complete()` | Powers extraction, chat, reasoning, and per-field re-generation |
| **System Prompts** | Dynamic schema enforcement + user-defined Custom Extraction Rules |
| **Streaming UI** | Real-time token streaming visualization during extraction |
| `anna.chat.write_message()` | Audit log on sync approval |
| `anna.window.set_title()` | Dynamic title management |
| **State management** | AI JSON → React form state → editable fields → Session History |
| **Human-in-the-Loop** | Approval gate before any data commit |

---

## Run Locally

```bash
npm install

# With mock LLM (offline, uses fixture JSON):
npm run dev:mock

# Against real anna server (requires login):
anna-app login --host https://anna.partners
npm run dev:real

# UI only (no LLM bridge):
npm run dev:off
```

Requires `uv` for the Python bridge:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

---

## Files

| Path | What |
|---|---|
| `manifest.json` | Anna app manifest — permissions, views, CSP |
| `app.json` | App metadata (slug, name, description, category) |
| `bundle/index.html` | Single-page UI: 4-stage workflow |
| `bundle/style.css` | Premium dark UI design system |
| `bundle/app.js` | Core logic: Anna integration, state, form management |
| `fixtures/happy-path.jsonl` | Mock LLM response for offline testing |

---

## Why This Wins

1. **Solves a Real Enterprise Pain Point** — CRM data hygiene costs sales teams millions annually.
2. **Advanced AI Integration** — Uses multiple LLM patterns (structured extraction, conversational chat, targeted re-extraction, streaming).
3. **Customizable** — Custom Rules Engine lets users teach the AI their specific company definitions and add custom CRM fields.
4. **Demonstrates AI Safety** — Transparent reasoning and human-in-the-loop review prevent hallucinated data from destroying CRM records.
5. **Anna-native** — Deep integration with `anna.llm.complete`, state management, and platform UI conventions.

---

*Built for the Anna AI-Native App Hackathon — DoraHacks 2204*
