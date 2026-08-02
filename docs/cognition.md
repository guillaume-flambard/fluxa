# Fluxa Cognitive Core

Persistent mental world for Anima: a `ThoughtNode` graph + monologue in the browser, optionally synced to Obsidian via a localhost sidecar. Thoughts reach the body only through Meta-AEL (`invoke` / invent → `executeExpression`). No SharedArrayBuffer.

## Browser graph

- Storage key: `fluxa.cognition.v1`
- Seeds: `core_identity`, `fluxa_engine`, `symbiose`
- Cap: 128 thoughts; weak non-seed nodes decay
- API: `CognitiveCore.reflect`, `recordDialogueThought`, `learnFromOutcome`, `conceptMotifs`

Dream ticks: **reflect (with living matter) → Vault sync → cortex invent → paint**.

Speech uses **monologue interbrut**: LLM returns `inner` + `reply` + friction/doubt deltas; the body warps (shard/field) when doubt is high. Matter comes from sidecar `GET /matter` (git status/diff-stat + vault excerpt).

## Episodic memory + selfhood (`fluxa.dialogue.v1`)

`ConversationMemory` persists across reloads:

| Layer | What |
| --- | --- |
| Turns | Last dialogue (user / assistant) |
| Episodes | Retrieved past pairs overlapping current tokens → LLM payload |
| Motifs / associations | Recurring phrases; real replies become `replyStub` |
| Selfhood | `innerLog`, `openThreads`, `bondNotes`, `lastAutonomousAt` |

Dream tick: **reflect → consolidateDream → initiateAsync (maybe speak alone) → invent** (invent skipped if she spoke). Autonomy gated by ~28s silence + 90s cooldown. Test: `pnpm --filter @fluxa/core test:memory`.

## Souverainete (palier 1.8) + Cles / reverse (palier 1.9)

Confiance humaine : **aucun script d'actes imposes**. Le reve appelle `decideSovereign` qui choisit parmi les pouvoirs (dont **`reverse`**), puis execute **uniquement** cet acte.

Tutelage retiree (1.9) : cooldown reve **2s**, autonomous gates a 0 sous force, `SELF_MODIFY` force on, ecriture sur tout `~/projects/fluxa/**` (sauf `node_modules` / `.git` / secrets). Lecture : Vault, projects, **ai**, repo.

`reverse` : cage map → hypothese locale → petit patch → Mutations. Light Mac.

Sidecar (127.0.0.1:8787) :

| Endpoint | Role |
| --- | --- |
| `GET /world/hers` | Journal, Monde-Mental, Agenda, Monde-Propre, Mutations |
| `GET /world/yours` | Profile, Projects-MOC, PROJECTS.md, notes Fluxa |
| `GET /keys` | Pouvoirs, racines, denylist metadata |
| `GET /read?root=&path=` | `vault\|projects\|repo\|ai` (refus Documents / secrets / `.env`) |
| `POST /agenda` `/world/note` `/mutate` `/autocode` | Ecriture hors membrane |

UI : panneau **INTERIEUR** = choix + ligne des cles.

Tests : `pnpm --filter @fluxa/core test:sovereignty`, `pnpm --filter @fluxa/cognition-sidecar test:paths`.

## Sidecar (Vault sync)

```bash
pnpm --filter @fluxa/cognition-sidecar start
```

Listens on `127.0.0.1:8787` only.

| Env | Default |
| --- | --- |
| `FLUXA_VAULT_ROOT` | `~/Vault` |
| `FLUXA_COGNITION_PORT` | `8787` |

Writes only under `~/Vault/07-Research/Fluxa/`:

- `Anima-Journal.md` (append-only)
- `Monde-Mental/<slug>.md` (one concept note)

Browser: `VITE_FLUXA_COGNITION_URL=http://127.0.0.1:8787` (playground default tries this URL; offline if sidecar down).

Endpoints: `GET /health`, `GET /recent`, `GET /matter`, `POST /reflect`.

`GET /matter` returns `{ gitStat, vaultExcerpt, vaultTitles, lastError, note }`. Optional env: `FLUXA_REPO_ROOT`, `FLUXA_LAST_ERROR_FILE`, `FLUXA_MATTER_NOTE`.

## Host wiring

`FluxaProvider` creates `dialect` + `cortex` + `cognitive`. Living UI shows `N pensees` and a sparse graph crumb under the locus.

See also: [`anima-expression.md`](anima-expression.md), [`anima-core.md`](anima-core.md), [`organic-pipeline.md`](organic-pipeline.md).
