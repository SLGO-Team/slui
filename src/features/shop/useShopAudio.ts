import { useEffect, useRef, useState } from "react";
import { createShopAudio } from "./audio";

// A failed or rejected command plays nothing: CS2's buy menu has no failure sound, the banner reports it.
export function useShopAudio(visible: boolean, volume: number) {
  const [audio] = useState(() => createShopAudio({ volume }));
  const mounted = useRef(false);

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

  return audio;
}
