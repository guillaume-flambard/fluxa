import { useCallback, useMemo, useRef, useState } from "react";
import {
  LocalDialogueEngine,
  mockVisceralStream,
  type DialogueTurn,
  type LearningStats,
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
  send: (text: string) => Promise<void>;
  resetMemory: () => void;
}

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m-${Date.now()}-${msgSeq}`;
}

/**
 * Local learning dialogue wired to the synaptic bridge + membrane body.
 */
export function useDialogue(): UseDialogueResult {
  const { engine, feedVisceralChunk, resetVisceralStream, recordLanguageInput } =
    useFluxa();
  const channels = useChannels();
  const engineRef = useRef<LocalDialogueEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new LocalDialogueEngine();
  }

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const turns = engineRef.current!.memory.getData().turns;
    return turns.map((t: DialogueTurn) => ({
      id: nextId(),
      role: t.role,
      text: t.text,
    }));
  });
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [statsTick, setStatsTick] = useState(0);

  const learningStats = useMemo(
    () => engineRef.current!.stats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statsTick, messages.length],
  );

  const resetMemory = useCallback(() => {
    engineRef.current!.resetMemory();
    setMessages([]);
    setStreamingText("");
    setStatsTick((n) => n + 1);
  }, []);

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

      const turn = engineRef.current!.respond(trimmed, {
        languageIntensity: channels.languageIntensity,
        presenceGain: channels.presenceGain,
        presence: channels.presence,
      });

      resetVisceralStream();
      let assembled = "";
      try {
        for await (const chunk of mockVisceralStream({
          turn,
          chunkSize: 10,
          delayMs: 18,
        })) {
          const partial = feedVisceralChunk(chunk);
          if (partial?.reply) {
            assembled = partial.reply;
            setStreamingText(assembled);
          }
          engine?.wake();
        }
      } finally {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", text: turn.reply },
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
      resetVisceralStream,
      feedVisceralChunk,
      engine,
    ],
  );

  return {
    messages,
    sending,
    streamingText,
    learningStats,
    send,
    resetMemory,
  };
}
