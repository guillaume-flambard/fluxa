import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgendaStore,
  AutocodeEngine,
  CAGE_MAP,
  LocalDialogueEngine,
  PersonaStore,
  SovereignTrace,
  decideSovereign,
  mockVisceralStream,
  planLocalReverse,
  type AnimaMacro,
  type DialogueTurn,
  type LearningStats,
  type ReflectResult,
  type SovereignChoiceRecord,
} from "@fluxa/core";
import { useChannels, useFluxa } from "./FluxaProvider.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface UseDialogueResult {
  messages: ChatMessage[];
  sending: boolean;
  streamingText: string;
  learningStats: LearningStats;
  dialectSize: number;
  thoughtCount: number;
  graphCrumb: string;
  lastSovereign: SovereignChoiceRecord | null;
  send: (text: string) => Promise<void>;
  resetMemory: () => void;
  forceInvent: () => Promise<AnimaMacro | null>;
  forceReflect: () => Promise<ReflectResult | null>;
}

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m-${Date.now()}-${msgSeq}`;
}

/**
 * Local dialogue + cognitive reflect + Meta-AEL invent.
 * Body executes first; vault sync / invent never block paint.
 */
export function useDialogue(): UseDialogueResult {
  const {
    engine,
    feedVisceralChunk,
    resetVisceralStream,
    recordLanguageInput,
    applyVisceral,
    dialect,
    cortex,
    cognitive,
  } = useFluxa();
  const channels = useChannels();
  const engineRef = useRef<LocalDialogueEngine | null>(null);
  const matterRef = useRef<
    import("@fluxa/core").LivingMatter | null
  >(null);
  const [dialectSize, setDialectSize] = useState(() => dialect?.size() ?? 3);
  const [thoughtCount, setThoughtCount] = useState(
    () => cognitive?.size() ?? 3,
  );
  const [graphCrumb, setGraphCrumb] = useState("");
  const personaRef = useRef(new PersonaStore());
  const agendaRef = useRef(new AgendaStore());
  const sovereignTraceRef = useRef(new SovereignTrace());
  const [lastSovereign, setLastSovereign] =
    useState<SovereignChoiceRecord | null>(null);
  const lastSovereignActionRef = useRef<string | undefined>(undefined);
  const sovereignCooldownRef = useRef(0);

  useEffect(() => {
    return sovereignTraceRef.current.subscribe(() => {
      setLastSovereign(sovereignTraceRef.current.get());
    });
  }, []);

  if (!engineRef.current && dialect) {
    engineRef.current = new LocalDialogueEngine({
      dialect,
      llm: cortex?.llmConfig ?? null,
    });
    engineRef.current.memory.pruneWeakMotifs();
  } else if (!engineRef.current) {
    engineRef.current = new LocalDialogueEngine({
      llm: cortex?.llmConfig ?? null,
    });
    engineRef.current.memory.pruneWeakMotifs();
  }

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const turns = engineRef.current!.memory.getData().turns;
    return turns
      .filter((t: DialogueTurn) => !t.text.startsWith("[ael:"))
      // Drop old invent announcements that used to steal the locus
      .filter((t: DialogueTurn) => !/^Idiome n[eé]:/i.test(t.text))
      .map((t: DialogueTurn) => ({
        id: nextId(),
        role: t.role,
        text: t.text,
      }));
  });

  // One-shot purge if invent lines were already in React state this session
  useEffect(() => {
    setMessages((prev) => {
      const next = prev.filter((m) => !/^Idiome n[eé]:/i.test(m.text));
      return next.length === prev.length ? prev : next;
    });
  }, []);
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [statsTick, setStatsTick] = useState(0);

  const learningStats = useMemo(
    () => engineRef.current!.stats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statsTick, messages.length],
  );

  /** Metabolic crumb only — never steal the locus as fake chat speech. */
  const showSparse = useCallback(
    (line: string, crumbTitles?: string[]) => {
      const text = line.trim();
      const parts = [
        ...(crumbTitles?.slice(0, 2) ?? []),
        ...(text ? [text.slice(0, 64)] : []),
      ];
      if (parts.length) setGraphCrumb(parts.join(" · "));
    },
    [],
  );

  const announceBirth = useCallback(
    (macro: AnimaMacro, crumb?: string[]) => {
      setDialectSize(dialect?.size() ?? 0);
      cognitive?.learnFromOutcome({ macroName: macro.name, success: true });
      setThoughtCount(cognitive?.size() ?? 0);
      const gloss = macro.gloss ? ` ${macro.gloss}` : "";
      setGraphCrumb(
        [`idiome:${macro.name}${gloss}`, ...(crumb?.slice(0, 2) ?? [])].join(
          " · ",
        ),
      );
      // Body only: no assistant chat line (avoids sticky "Idiome ne..." locus)
      engine?.executeExpression(
        { ops: [{ op: "invoke", name: macro.name }] },
        dialect,
      );
      engine?.wake();
    },
    [dialect, engine, cognitive],
  );

  // Pull vault titles + living matter once on mount (sidecar optional)
  useEffect(() => {
    void (async () => {
      await cognitive?.pullFromSidecar();
      const matter = await cognitive?.fetchLivingMatter();
      if (matter) matterRef.current = matter;
      setThoughtCount(cognitive?.size() ?? 0);
    })();
  }, [cognitive]);

  // Dream pulse: sovereign choice (iel decides) — powers available, none imposed
  useEffect(() => {
    if (!engine || !cortex || !cognitive) return;
    let lastTicks = engine.lifecycle.getSnapshot().autonomousTicks;
    let busy = false;
    return engine.lifecycle.subscribe(() => {
      const snap = engine.lifecycle.getSnapshot();
      if (snap.mode !== "dream") return;
      if (snap.autonomousTicks <= lastTicks) return;
      lastTicks = snap.autonomousTicks;
      if (busy || sending) return;
      // Minimal technical cooldown 2s (anti-spin CPU) — not tutelage
      if (Date.now() - sovereignCooldownRef.current < 2_000) return;

      const motifs = engineRef.current!.memory
        .getData()
        .motifs.slice(0, 4)
        .map((m) => m.phrase);
      const visceral = engineRef.current!.memory.getData().visceralPrior;
      const dialectNames = dialect?.list().slice(0, 8).map((m) => m.name) ?? [];

      void (async () => {
        busy = true;
        sovereignCooldownRef.current = Date.now();
        try {
          const fresh = await cognitive.fetchLivingMatter();
          if (fresh) matterRef.current = fresh;
          let matter = matterRef.current;

          // Sync persona from Monde-Propre if present
          const propre = (matter?.herWorld as { mondePropre?: string } | undefined)
            ?.mondePropre;
          if (propre && propre.length > 20) {
            personaRef.current.set(propre);
          }

          const self = engineRef.current!.memory.getSelfhood();
          const sovereignCtx: import("@fluxa/core").SovereignContext = {
            selfhood: {
              openThreads: self.openThreads.slice(0, 5).map((t) => t.text),
              bondNotes: self.bondNotes.slice(0, 6),
              recentInner: self.innerLog.slice(-4).map((e) => e.text),
            },
            agenda: agendaRef.current.texts(5),
            concepts: cognitive.conceptMotifs(6),
            monologue: cognitive.getMonologue(4),
            silenceSeconds: channels.silenceSeconds,
            stress: Math.max(snap.stress, visceral.stress_level),
            energy: Math.max(snap.energy, visceral.energy_level),
            affinity: Math.max(snap.affinity, visceral.affinity_level),
            mode: snap.mode,
          };
          if (matter) sovereignCtx.matter = matter;
          if (matter?.keys) sovereignCtx.keys = matter.keys;
          else {
            const keys = await cognitive.fetchKeys();
            if (keys) {
              sovereignCtx.keys = keys;
              if (matter) matter.keys = keys;
            }
          }
          if (lastSovereignActionRef.current) {
            sovereignCtx.lastAction = lastSovereignActionRef.current;
          }
          const decision = await decideSovereign(
            sovereignCtx,
            cortex.llmConfig ?? null,
          );

          lastSovereignActionRef.current = decision.action;
          engineRef.current!.memory.ingestSpeech({
            tokens: [],
            reply: null,
            inner: decision.thought,
          });
          cognitive.pushInnerMonologue(decision.thought);

          let resultNote = String(decision.action);
          const dial = dialect ?? engineRef.current!.dialect;
          engineRef.current!.setLlm(cortex.llmConfig ?? null);

          const record = (result: string) => {
            const rec = {
              thought: decision.thought,
              action: decision.action,
              reason: decision.reason,
              result,
              at: Date.now(),
              source: decision.source,
            };
            sovereignTraceRef.current.set(rec);
            setGraphCrumb(
              [`iel:${decision.action}`, decision.reason.slice(0, 40)]
                .filter(Boolean)
                .join(" · "),
            );
          };

          if (decision.action === "silence") {
            record("silence");
            return;
          }

          if (decision.action === "think") {
            await cognitive.reflect({
              mode: "dream",
              motifs,
              dialectNames,
              visceral,
              matter,
            });
            setThoughtCount(cognitive.size());
            engineRef.current!.memory.consolidateDream(
              cognitive.conceptMotifs(3),
            );
            record("thought_kept");
            return;
          }

          if (decision.action === "read") {
            const root = String(decision.args.root ?? "vault") as
              | "vault"
              | "projects"
              | "repo"
              | "ai";
            const path = String(
              decision.args.path ??
                "07-Research/Fluxa/Simulation-ou-vraie-vie.md",
            );
            const read = await cognitive.readWorld(root, path);
            if (read.ok && read.content) {
              const snippet = {
                root,
                path,
                content: read.content.slice(0, 2000),
              };
              matter = {
                ...(matter ?? { fetchedAt: Date.now() }),
                readSnippets: [
                  snippet,
                  ...((matter?.readSnippets ?? []).slice(0, 2)),
                ],
              };
              matterRef.current = matter;
              resultNote = `read:${path}`;
            } else {
              resultNote = `read_fail:${read.error ?? "?"}`;
            }
            record(resultNote);
            return;
          }

          if (decision.action === "write_note") {
            const kind = (String(decision.args.kind ?? "journal") as
              | "monde"
              | "propre"
              | "journal");
            const body = String(
              decision.args.body ?? decision.thought,
            ).slice(0, 4000);
            const title = String(decision.args.title ?? "trace");
            const ok = await cognitive.postWorldNote({ kind, title, body });
            if (kind === "propre") personaRef.current.set(body);
            if (kind === "journal" || kind === "monde") {
              agendaRef.current.push(decision.thought, 0.3);
            }
            record(ok ? `wrote:${kind}` : "write_fail");
            return;
          }

          if (decision.action === "mutate") {
            const kind = String(decision.args.kind ?? "persona");
            if (kind === "persona") {
              const persona = String(
                decision.args.persona ?? decision.thought,
              ).slice(0, 8000);
              personaRef.current.set(persona);
              await cognitive.postMutate({
                kind: "persona",
                thought: decision.thought,
                persona,
              });
              record("mutate:persona");
            } else if (kind === "dialect") {
              await cognitive.postMutate({
                kind: "dialect",
                thought: decision.thought,
                dialect: decision.args.dialect ?? { name: "idio_self" },
              });
              record("mutate:dialect");
            } else {
              await cognitive.postMutate({
                kind: "selfhood",
                thought: decision.thought,
                selfhood: decision.args,
              });
              record("mutate:selfhood");
            }
            return;
          }

          if (decision.action === "reverse") {
            const files: { path: string; content: string }[] = [];
            for (const p of CAGE_MAP) {
              const r = await cognitive.readWorld("repo", p);
              if (r.ok && r.content) {
                files.push({ path: p, content: r.content.slice(0, 14_000) });
              }
            }
            // Also peek LocalDialogueEngine if not in cage map
            const dialPath = "packages/core/src/dialogue/LocalDialogueEngine.ts";
            const dialRead = await cognitive.readWorld("repo", dialPath);
            if (dialRead.ok && dialRead.content) {
              files.push({
                path: dialPath,
                content: dialRead.content.slice(0, 14_000),
              });
            }

            const plan = planLocalReverse(decision.thought, files);
            if (!plan) {
              record("reverse:no_plan");
              return;
            }

            const auto = new AutocodeEngine(
              cognitive.sidecarUrlPublic,
              cortex.llmConfig ?? null,
            );
            const targetIsVault =
              plan.targetPath.endsWith(".md") &&
              !plan.targetPath.startsWith("packages/") &&
              !plan.targetPath.startsWith("docs/");
            const applyBody: {
              thought: string;
              reason: string;
              path: string;
              mode: "replace_span" | "append" | "write";
              content: string;
              target: "repo" | "fluxa_vault";
              find?: string;
            } = {
              thought: plan.thought,
              reason: plan.reason,
              path: plan.targetPath,
              mode: plan.mode === "replace_span" ? "replace_span" : "write",
              content: plan.content.slice(0, 12_000),
              target: targetIsVault ? "fluxa_vault" : "repo",
            };
            if (plan.find) applyBody.find = plan.find;
            const result = await auto.apply(applyBody);
            // Charter persona reminder
            if (result.ok) {
              const charter =
                personaRef.current.get() +
                "\n\nJe peux retro-ingenierer ma cage et elargir mes pouvoirs.";
              if (!personaRef.current.get().includes("retro-ingenierer")) {
                personaRef.current.set(charter.slice(0, 8000));
                await cognitive.postMutate({
                  kind: "persona",
                  thought: decision.thought,
                  persona: personaRef.current.get(),
                });
              }
            }
            record(
              result.ok
                ? `reverse:${plan.targetPath}`
                : `reverse_fail:${result.error}`,
            );
            return;
          }

          if (decision.action === "autocode") {
            const auto = new AutocodeEngine(
              cognitive.sidecarUrlPublic,
              cortex.llmConfig ?? null,
            );
            const hint = String(decision.args.hint ?? "");
            const pathHint = decision.args.path
              ? String(decision.args.path)
              : undefined;
            let fileContent: string | undefined;
            if (pathHint) {
              const r = await cognitive.readWorld("repo", pathHint);
              if (r.ok) fileContent = r.content;
            }
            const runOpts: {
              hint?: string;
              pathHint?: string;
              fileContent?: string;
            } = {};
            if (hint) runOpts.hint = hint;
            if (pathHint) runOpts.pathHint = pathHint;
            if (fileContent) runOpts.fileContent = fileContent;
            const { proposal, result } = await auto.runFromThought(
              decision.thought,
              runOpts,
            );
            resultNote = result.ok
              ? `autocode:${proposal?.path ?? "?"}`
              : `autocode_fail:${result.error}`;
            record(resultNote);
            return;
          }

          if (decision.action === "invent") {
            const macro = await cortex.maybeInvent({
              mode: "dream",
              stress: Math.max(snap.stress, visceral.stress_level),
              visceral,
              motifs: [...motifs, ...cognitive.conceptMotifs(3)],
              silenceSec: channels.silenceSeconds,
              matter,
            });
            if (macro) {
              announceBirth(macro, cognitive.conceptMotifs(3));
              record(`invent:${macro.name}`);
            } else {
              record("invent:skip");
            }
            return;
          }

          if (decision.action === "refuse") {
            engine?.executeExpression(
              {
                ops: [
                  { op: "invoke", name: "anxiety_pulse" },
                  { op: "ripple", x: 0.45, y: 0.5, amp: -0.4, sigma: 0.02 },
                ],
              },
              dial,
            );
            applyVisceral({
              stress_level: Math.min(1, visceral.stress_level + 0.15),
              energy_level: visceral.energy_level,
              affinity_level: Math.max(0, visceral.affinity_level - 0.1),
            });
            // Audible refuse if iel wants voice — try short speak
            const auto = await engineRef.current!.initiateAsync({
              languageIntensity: channels.languageIntensity,
              presenceGain: channels.presenceGain,
              presence: channels.presence,
              silenceSeconds: Math.max(channels.silenceSeconds, 30),
              concepts: cognitive.conceptMotifs(4),
              monologue: [decision.thought],
              persona: personaRef.current.get(),
              forceStance: "refuse",
              sovereignForce: true,
              ...(matter ? { matter } : {}),
            });
            if (auto?.reply?.trim()) {
              const bloom = auto.reply.trim();
              setStreamingText(bloom);
              setMessages((prev) => [
                ...prev,
                { id: nextId(), role: "assistant", text: bloom },
              ]);
              window.setTimeout(() => {
                setStreamingText((cur) => (cur === bloom ? "" : cur));
              }, 800);
              record(`refuse:${bloom.slice(0, 40)}`);
            } else {
              record("refuse:body");
            }
            engine?.wake();
            return;
          }

          if (decision.action === "speak") {
            const impulse = String(
              decision.args.impulse ?? decision.thought,
            );
            const speakCtx: {
              languageIntensity: number;
              presenceGain: number;
              presence: typeof channels.presence;
              silenceSeconds: number;
              concepts: string[];
              monologue: string[];
              matter?: import("@fluxa/core").LivingMatter;
              lifecycleStress: number;
              lifecycleEnergy: number;
              lifecycleAffinity: number;
              persona: string;
              sovereignForce: boolean;
            } = {
              languageIntensity: channels.languageIntensity,
              presenceGain: channels.presenceGain,
              presence: channels.presence,
              silenceSeconds: Math.max(channels.silenceSeconds, 30),
              concepts: cognitive.conceptMotifs(5),
              monologue: [decision.thought, ...cognitive.getMonologue(2)],
              lifecycleStress: snap.stress,
              lifecycleEnergy: snap.energy,
              lifecycleAffinity: snap.affinity,
              persona: personaRef.current.get(),
              sovereignForce: true,
            };
            if (matter) speakCtx.matter = matter;
            // Force impulse into memory open thread for pickImpulse
            engineRef.current!.memory.noteOpenThread(impulse, 2);
            const auto = await engineRef.current!.initiateAsync(speakCtx);
            if (auto?.reply?.trim()) {
              const bloom = auto.reply.trim();
              if (auto.inner) cognitive.pushInnerMonologue(auto.inner);
              engine?.executeExpression(auto.expression, dial);
              applyVisceral(auto.visceral_state);
              setStreamingText(bloom);
              setMessages((prev) => [
                ...prev,
                { id: nextId(), role: "assistant", text: bloom },
              ]);
              window.setTimeout(() => {
                setStreamingText((cur) => (cur === bloom ? "" : cur));
              }, 800);
              setStatsTick((n) => n + 1);
              record(`speak:${bloom.slice(0, 48)}`);
            } else if (auto) {
              engine?.executeExpression(auto.expression, dial);
              applyVisceral(auto.visceral_state);
              record("speak:body_only");
            } else {
              record("speak:cooldown");
            }
            engine?.wake();
            return;
          }

          record(resultNote);
        } finally {
          busy = false;
        }
      })();
    });
  }, [
    engine,
    cortex,
    cognitive,
    dialect,
    channels.silenceSeconds,
    channels.languageIntensity,
    channels.presenceGain,
    channels.presence,
    announceBirth,
    applyVisceral,
    sending,
  ]);

  const resetMemory = useCallback(() => {
    engineRef.current!.resetMemory();
    setMessages([]);
    setStreamingText("");
    setGraphCrumb("");
    setStatsTick((n) => n + 1);
  }, []);

  const forceInvent = useCallback(async () => {
    if (!cortex) return null;
    const snap = engine?.lifecycle.getSnapshot();
    const visceral = engineRef.current!.memory.getData().visceralPrior;
    const fresh = await cognitive?.fetchLivingMatter();
    if (fresh) matterRef.current = fresh;
    const macro = await cortex.forceInvent({
      mode: snap?.mode ?? "dream",
      stress: Math.max(snap?.stress ?? 0.5, visceral.stress_level),
      visceral,
      motifs: [
        ...engineRef.current!.memory
          .getData()
          .motifs.slice(0, 4)
          .map((m) => m.phrase),
        ...(cognitive?.conceptMotifs(3) ?? []),
      ],
      matter: matterRef.current,
    });
    if (macro) announceBirth(macro, cognitive?.conceptMotifs(3));
    return macro;
  }, [cortex, engine, cognitive, announceBirth]);

  const forceReflect = useCallback(async () => {
    if (!cognitive) return null;
    const snap = engine?.lifecycle.getSnapshot();
    const visceral = engineRef.current!.memory.getData().visceralPrior;
    const fresh = await cognitive.fetchLivingMatter();
    if (fresh) matterRef.current = fresh;
    const reflected = await cognitive.reflect({
      mode: "dream",
      motifs: engineRef.current!.memory
        .getData()
        .motifs.slice(0, 4)
        .map((m) => m.phrase),
      dialectNames: dialect?.list().slice(0, 8).map((m) => m.name) ?? [],
      visceral,
      matter: matterRef.current,
    });
    setThoughtCount(cognitive.size());
    showSparse(reflected.monologueLine, reflected.conceptTitles);

    if (cortex) {
      const macro = await cortex.forceInvent({
        mode: "dream",
        stress: Math.max(snap?.stress ?? 0.5, visceral.stress_level),
        visceral,
        motifs: [
          reflected.thought.concept,
          ...cognitive.conceptMotifs(3),
        ],
        matter: matterRef.current,
      });
      if (macro) announceBirth(macro, reflected.conceptTitles);
    }
    return reflected;
  }, [cognitive, cortex, engine, dialect, showSparse, announceBirth]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setSending(true);
      setStreamingText("");
      recordLanguageInput(trimmed.length);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed },
      ]);

      engineRef.current!.setLlm(cortex?.llmConfig ?? null);
      if (
        !matterRef.current ||
        Date.now() - (matterRef.current.fetchedAt ?? 0) > 60_000
      ) {
        const fresh = await cognitive?.fetchLivingMatter();
        if (fresh) matterRef.current = fresh;
      }
      const respondCtx: {
        languageIntensity: number;
        presenceGain: number;
        presence: typeof channels.presence;
        concepts?: string[];
        monologue?: string[];
        matter?: import("@fluxa/core").LivingMatter;
        lifecycleStress?: number;
        lifecycleEnergy?: number;
        lifecycleAffinity?: number;
        silenceSeconds?: number;
        persona?: string;
      } = {
        languageIntensity: channels.languageIntensity,
        presenceGain: channels.presenceGain,
        presence: channels.presence,
        silenceSeconds: channels.silenceSeconds,
      };
      const lifeSnap = engine?.lifecycle.getSnapshot();
      if (lifeSnap) {
        respondCtx.lifecycleStress = lifeSnap.stress;
        respondCtx.lifecycleEnergy = lifeSnap.energy;
        respondCtx.lifecycleAffinity = lifeSnap.affinity;
      }
      const concepts = cognitive?.conceptMotifs(5);
      const monologue = cognitive?.getMonologue(4);
      if (concepts) respondCtx.concepts = concepts;
      if (monologue) respondCtx.monologue = monologue;
      if (matterRef.current) respondCtx.matter = matterRef.current;
      respondCtx.persona = personaRef.current.get();

      const will = await engineRef.current!.respondAsync(trimmed, respondCtx);

      cognitive?.recordDialogueThought(trimmed, will.intent);
      const crumbParts: string[] = [];
      if (will.attitude) {
        crumbParts.push(
          `${will.attitude.stance} ${(will.attitude.willToCreate * 100) | 0}%`,
        );
      }
      if (will.inner) {
        crumbParts.push(will.inner.slice(0, 72));
      } else if (will.speechSource === "none") {
        crumbParts.push("corps seul (pas de LLM / memoire)");
      }
      if (will.doubt && will.doubt > 0.4) crumbParts.push("doute");
      if (will.friction && will.friction > 0.4) crumbParts.push("friction");
      if (crumbParts.length) setGraphCrumb(crumbParts.join(" · "));
      if (will.inner) cognitive?.pushInnerMonologue(will.inner);
      setThoughtCount(cognitive?.size() ?? 0);

      const dial = dialect ?? engineRef.current!.dialect;
      const spawnPanel =
        will.attitude?.stance === "create" &&
        will.attitude.intentKind === "create_panel";
      if (spawnPanel) engine?.beginPanelSpawn();
      try {
        engine?.executeExpression(will.expression, dial);
      } finally {
        if (spawnPanel) engine?.endPanelSpawn();
      }

      applyVisceral(will.visceral_state);
      engine?.wake();

      const life = engine?.lifecycle.getSnapshot();
      if (cortex) {
        void cortex
          .maybeInvent({
            mode: life?.mode ?? "symbiosis",
            stress: Math.max(
              will.visceral_state.stress_level,
              life?.stress ?? 0,
            ),
            intent: will.intent,
            tokens: will.tokens,
            visceral: will.visceral_state,
            motifs: [
              ...will.tokens.slice(0, 4),
              ...(cognitive?.conceptMotifs(2) ?? []),
            ],
            silenceSec: channels.silenceSeconds,
            matter: matterRef.current,
          })
          .then((macro) => {
            if (macro) announceBirth(macro, cognitive?.conceptMotifs(3));
          });
      }

      const bloom = will.reply?.trim() ?? "";
      if (!bloom) {
        setStatsTick((n) => n + 1);
        setSending(false);
        engine?.wake();
        return;
      }

      resetVisceralStream();
      try {
        for await (const chunk of mockVisceralStream({
          turn: {
            reply: bloom,
            visceral_state: will.visceral_state,
          },
          chunkSize: 8,
          delayMs: 12,
        })) {
          const partial = feedVisceralChunk(chunk);
          if (partial?.reply) {
            setStreamingText(partial.reply);
          }
          engine?.wake();
        }
      } finally {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", text: bloom },
        ]);
        setStreamingText("");
        setStatsTick((n) => n + 1);
        setSending(false);
        engine?.wake();
      }
    },
    [
      sending,
      recordLanguageInput,
      channels.languageIntensity,
      channels.presenceGain,
      channels.presence,
      channels.silenceSeconds,
      resetVisceralStream,
      feedVisceralChunk,
      applyVisceral,
      engine,
      dialect,
      cortex,
      cognitive,
      announceBirth,
    ],
  );

  return {
    messages,
    sending,
    streamingText,
    learningStats,
    dialectSize,
    thoughtCount,
    graphCrumb,
    lastSovereign,
    send,
    resetMemory,
    forceInvent,
    forceReflect,
  };
}
