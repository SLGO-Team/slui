import { useEffect, useRef, useState } from "react";
import { createShopAudio } from "./audio";
import type { ShopItemView } from "./model";

export function useShopAudio(visible: boolean, items: readonly ShopItemView[], volume: number) {
  const [audio] = useState(() => createShopAudio({ volume }));
  const mounted = useRef(false);
  const previousCommands = useRef(new Map(items.map((item) => [item.item_id, item.commandState])));

  useEffect(() => {
    mounted.current = true;
    audio.preload();
    return () => {
      mounted.current = false;
      // StrictMode replays effects synchronously; keep its active clips intact.
      queueMicrotask(() => {
        if (!mounted.current) audio.dispose();
      });
    };
  }, [audio]);

  useEffect(() => audio.setVolume(volume), [audio, volume]);

  useEffect(() => {
    if (!visible) audio.stop();
  }, [audio, visible]);

  useEffect(() => {
    const failed = items.some((item) => {
      const previous = previousCommands.current.get(item.item_id);
      return previous !== undefined && previous !== item.commandState
        && (item.commandState === "failed" || item.commandState === "rejected");
    });
    previousCommands.current = new Map(items.map((item) => [item.item_id, item.commandState]));
    if (visible && failed) audio.play("deny");
  }, [audio, items, visible]);

  return audio;
}
