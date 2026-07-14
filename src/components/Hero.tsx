"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { withBasePath } from "../lib/assets";
import { CATALOG_SECTIONS } from "../lib/catalog";
import styles from "./Hero.module.css";

const IMAGE_SLIDE_DURATION = 6500;

type HeroMedia =
  | { type: "image"; src: string }
  | { type: "video"; src: string; poster: string };

interface HeroSlide {
  id: string;
  media: HeroMedia;
  alt: string;
  eyebrow: string;
  title: string;
  href: string;
  durationMs?: number;
  objectPosition?: string;
}

const HERO_SLIDES: HeroSlide[] = [
  {
    id: "new-arrivals",
    media: {
      type: "video",
      src: "/hero/new-arrivals.mp4",
      poster: "/images/collection-women.png",
    },
    alt: "Новая коллекция женской одежды",
    eyebrow: "Актуальное",
    title: "Новинки",
    href: CATALOG_SECTIONS.new.href,
    durationMs: IMAGE_SLIDE_DURATION,
    objectPosition: "50% 50%",
  },
  {
    id: "clothing",
    media: { type: "image", src: "/images/collection-women.png" },
    alt: "Женская коллекция одежды",
    eyebrow: "Каталог",
    title: "Одежда",
    href: CATALOG_SECTIONS.clothing.href,
    durationMs: IMAGE_SLIDE_DURATION,
    objectPosition: "50% 40%",
  },
  {
    id: "sale",
    media: { type: "image", src: "/hero/sale-campaign.png" },
    alt: "Женские образы из специальной подборки",
    eyebrow: "Специальное предложение",
    title: "Sale до −50%",
    href: "/catalog?section=sale",
    durationMs: IMAGE_SLIDE_DURATION,
    objectPosition: "50% 50%",
  },
];

export default function Hero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);
  const [failedVideos, setFailedVideos] = useState<Record<string, boolean>>({});
  const [readyVideos, setReadyVideos] = useState<Record<string, boolean>>({});
  const sectionRef = useRef<HTMLElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const progressRef = useRef(0);

  const currentSlide = HERO_SLIDES[activeIndex];
  const isPlaybackActive = isHeroVisible && isDocumentVisible;
  const isCurrentVideoFailed = Boolean(failedVideos[currentSlide.id]);
  const isTimedSlide = currentSlide.media.type === "image" || isCurrentVideoFailed;

  const updateProgress = useCallback((value: number) => {
    const nextValue = Math.min(Math.max(value, 0), 1);
    progressRef.current = nextValue;
    setProgress(nextValue);
  }, []);

  const nextSlide = useCallback(() => {
    progressRef.current = 0;
    setProgress(0);
    setActiveIndex((index) => (index + 1) % HERO_SLIDES.length);
  }, []);

  const previousSlide = useCallback(() => {
    progressRef.current = 0;
    setProgress(0);
    setActiveIndex((index) => (index - 1 + HERO_SLIDES.length) % HERO_SLIDES.length);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsHeroVisible(entry.isIntersecting && entry.intersectionRatio > 0.1),
      { threshold: [0, 0.1, 0.25] },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    Object.entries(videoRefs.current).forEach(([id, video]) => {
      if (!video) return;
      video.pause();

      if (id === currentSlide.id) {
        video.currentTime = 0;
      }
    });
  }, [activeIndex, currentSlide.id]);

  useEffect(() => {
    Object.entries(videoRefs.current).forEach(([id, video]) => {
      if (!video) return;

      const shouldPlay =
        id === currentSlide.id &&
        currentSlide.media.type === "video" &&
        !failedVideos[id] &&
        isPlaybackActive;

      if (shouldPlay) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
  }, [currentSlide.id, currentSlide.media.type, failedVideos, isPlaybackActive]);

  useEffect(() => {
    if (!isTimedSlide || !isPlaybackActive) return;

    const duration = currentSlide.durationMs ?? IMAGE_SLIDE_DURATION;
    const startedAt = performance.now() - progressRef.current * duration;
    let animationFrame = 0;
    let lastRenderedProgress = progressRef.current;

    const tick = (now: number) => {
      const nextProgress = Math.min((now - startedAt) / duration, 1);

      if (nextProgress === 1 || nextProgress - lastRenderedProgress >= 0.008) {
        lastRenderedProgress = nextProgress;
        updateProgress(nextProgress);
      }

      if (nextProgress >= 1) {
        nextSlide();
        return;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    activeIndex,
    currentSlide.durationMs,
    isPlaybackActive,
    isTimedSlide,
    nextSlide,
    updateProgress,
  ]);

  const handleKeyboardNavigation = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      previousSlide();
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextSlide();
    }
  };

  return (
    <section
      ref={sectionRef}
      className={styles.hero}
      aria-label="Главная кампания"
      aria-roledescription="карусель"
      onKeyDown={handleKeyboardNavigation}
    >
      <div className={styles.mediaStack} aria-hidden="true">
        {HERO_SLIDES.map((slide, index) => {
          const isActive = index === activeIndex;
          const mediaFailed = Boolean(failedVideos[slide.id]);

          return (
            <div
              key={slide.id}
              className={`${styles.mediaLayer} ${isActive ? styles.mediaLayerActive : ""}`}
            >
              {slide.media.type === "image" ? (
                <Image
                  src={slide.media.src}
                  alt=""
                  fill
                  sizes="100vw"
                  loading={index === 1 ? "eager" : "lazy"}
                  className={styles.image}
                  style={{ objectPosition: slide.objectPosition }}
                />
              ) : (
                <>
                  <Image
                    src={slide.media.poster}
                    alt=""
                    fill
                    priority={index === 0}
                    sizes="100vw"
                    className={styles.image}
                    style={{ objectPosition: slide.objectPosition }}
                  />
                  {!mediaFailed && (
                    <video
                      ref={(node) => {
                        videoRefs.current[slide.id] = node;
                      }}
                      src={withBasePath(slide.media.src)}
                      muted
                      playsInline
                      autoPlay={isActive}
                      preload="auto"
                      disablePictureInPicture
                      className={`${styles.video} ${
                        readyVideos[slide.id] ? styles.videoReady : ""
                      }`}
                      style={{ objectPosition: slide.objectPosition }}
                      onCanPlay={(event) => {
                        setReadyVideos((videos) =>
                          videos[slide.id] ? videos : { ...videos, [slide.id]: true },
                        );

                        if (isActive && isPlaybackActive) {
                          void event.currentTarget.play().catch(() => undefined);
                        }
                      }}
                      onTimeUpdate={(event) => {
                        const video = event.currentTarget;
                        if (!isActive || !Number.isFinite(video.duration) || video.duration <= 0) {
                          return;
                        }

                        updateProgress(video.currentTime / video.duration);
                      }}
                      onEnded={() => {
                        if (isActive) nextSlide();
                      }}
                      onError={() => {
                        setFailedVideos((videos) => ({ ...videos, [slide.id]: true }));
                      }}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.gradient} />

      <Link
        key={currentSlide.id}
        href={currentSlide.href}
        className={styles.slideLink}
        aria-label={`Открыть раздел «${currentSlide.title}»`}
      >
        <div className={styles.content}>
          <span className={styles.eyebrow}>{currentSlide.eyebrow}</span>
          <h1 className={styles.title}>{currentSlide.title}</h1>

          <div className={styles.progress} aria-hidden="true">
            {HERO_SLIDES.map((slide, index) => {
              const segmentProgress = index < activeIndex ? 1 : index === activeIndex ? progress : 0;

              return (
                <span key={slide.id} className={styles.progressTrack}>
                  <span
                    className={styles.progressFill}
                    style={{ transform: `scaleX(${segmentProgress})` }}
                  />
                </span>
              );
            })}
          </div>

          <span className={styles.linkLabel}>Смотреть</span>
        </div>
      </Link>

      <button
        type="button"
        className={`${styles.arrowButton} ${styles.arrowPrevious}`}
        aria-label="Предыдущий слайд"
        title="Предыдущий слайд"
        onClick={previousSlide}
      >
        <span className={styles.arrowIcon} />
      </button>

      <button
        type="button"
        className={`${styles.arrowButton} ${styles.arrowNext}`}
        aria-label="Следующий слайд"
        title="Следующий слайд"
        onClick={nextSlide}
      >
        <span className={styles.arrowIcon} />
      </button>
    </section>
  );
}
