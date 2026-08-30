import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import lottie from 'lottie-web/build/player/lottie_light';
import { ungzip } from 'pako';

type StickerName =
  | 'idle'
  | 'thinking'
  | 'hunting'
  | 'success'
  | 'security'
  | 'secret';

interface TgsStickerProps {
  name: StickerName;
  label: string;
  className?: string;
  loop?: boolean;
}

const animationCache = new Map<StickerName, object>();

export function TgsSticker({
  name,
  label,
  className = '',
  loop = true,
}: TgsStickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let animation: AnimationItem | undefined;
    let cancelled = false;
    setFailed(false);

    async function mountAnimation() {
      try {
        let animationData = animationCache.get(name);
        if (!animationData) {
          const response = await fetch(
            `${import.meta.env.BASE_URL}stickers/${name}.tgs`,
            { cache: 'force-cache' },
          );

          if (!response.ok) {
            throw new Error(`Sticker request failed: ${response.status}`);
          }

          const compressed = new Uint8Array(await response.arrayBuffer());
          animationData = JSON.parse(ungzip(compressed, { to: 'string' })) as object;
          animationCache.set(name, animationData);
        }

        if (cancelled || !containerRef.current) return;

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: reduceMotion ? false : loop,
          autoplay: !reduceMotion,
          animationData,
          rendererSettings: {
            progressiveLoad: true,
            preserveAspectRatio: 'xMidYMid meet',
          },
        });

        if (reduceMotion) {
          animation.goToAndStop(0, true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void mountAnimation();

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [loop, name]);

  return (
    <div
      className={`sticker ${failed ? 'sticker--failed' : ''} ${className}`}
      role="img"
      aria-label={label}
    >
      <div ref={containerRef} className="sticker__canvas" aria-hidden="true" />
    </div>
  );
}

export type { StickerName };
