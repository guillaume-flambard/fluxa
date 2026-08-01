# Synaptic Bridge — AI ↔ Fluxa

Bidirectional coupling between an LLM orchestration pipeline and the Fluxa metabolism / WebGL body.

## Choice this pass

**Downstream Streaming JSON first.** Upstream perception is typed and exposed (`user_agitation` + system-note helper) but not wired to a live LLM client.

## Wire format

```json
{
  "reply": "…",
  "visceral_state": {
    "stress_level": 0.0,
    "energy_level": 0.0,
    "affinity_level": 0.0
  }
}
```

Vector $\vec{V} = [s, e, a]$ ∈ [0,1]³ maps to:

| Field | Target |
| --- | --- |
| `stress_level` | `HomeostasisEngine.setTargetStress` → `u_stress` |
| `energy_level` | `setEnergyBias` → `u_energy` blend |
| `affinity_level` | `u_attraction` (render stub toward pointer UV) |

## Modules

- `VisceralStreamParser` — incremental extraction from chunked JSON
- `SynapticBridge` — applies visceral state to homeostasis + affinity
- `UserAgitationTracker` — EMA of clicks / impulses → `user_agitation`
- `formatPerceptionNote` — `[System Note: User agitation is at X/1.0]`

## System prompt sketch (for future host)

> Tu es une entité dotée d'un corps virtuel fluide. Pour chaque réponse, retourne JSON avec `reply` et `visceral_state` (`stress_level`, `energy_level`, `affinity_level` ∈ [0,1]).
