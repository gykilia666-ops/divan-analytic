"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

/** Насколько изображение длиннее окна: этот запас и «проезжает» за всю прокрутку страницы. */
const TRAVEL = 0.18;

/**
 * Фон сайта: фото удара по мячу, которое плавно смещается пропорционально прокрутке страницы
 * (верх страницы — верх кадра, низ страницы — низ кадра). Декоративное: скрыто от скринридеров,
 * не перехватывает клики, при prefers-reduced-motion остается неподвижным.
 * Фото: Alfonso Scarpa, Unsplash (лицензия Unsplash) — https://unsplash.com/photos/wcNU1-OY-BA
 */
export function ParallaxBackground() {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const update = () => {
      frame = 0;
      if (reduce.matches) {
        el.style.transform = "translate3d(0, 0, 0)";
        return;
      }
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable > 0 ? Math.min(Math.max(window.scrollY / scrollable, 0), 1) : 0;
      el.style.transform = `translate3d(0, ${(-progress * TRAVEL * 100).toFixed(3)}vh, 0)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reduce.addEventListener("change", schedule);
    // Высота страницы меняется при подгрузке данных и переходах без прокрутки.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reduce.removeEventListener("change", schedule);
      observer.disconnect();
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        ref={layer}
        data-testid="parallax-layer"
        className="absolute inset-x-0 top-0 will-change-transform"
        style={{ height: `${100 + TRAVEL * 100}vh` }}
      >
        <Image
          src="/images/bg-kick.webp"
          alt=""
          fill
          sizes="100vw"
          quality={60}
          className="object-cover object-[30%_50%]"
        />
      </div>
      {/* Затемнение (или осветление в светлой теме), чтобы текст поверх фона оставался читаемым. */}
      <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_80%,transparent)]" />
    </div>
  );
}
