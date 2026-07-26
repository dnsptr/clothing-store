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
import type { ContentSlide } from "../lib/content";
import styles from "./Hero.module.css";

const IMAGE_SLIDE_DURATION = 6500;

interface HeroProps {
  slides: ContentSlide[];
}

export default function Hero({ slides }: HeroProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);
  const [failedVideos, setFailedVideos] = useState<Record<string, boolean>>({});
  const [readyVideos, setReadyVideos] = useState<Record<string, boolean>>({});
  const sectionRef = useRef<HTMLElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const progressRef = useRef(0);

  // May be undefined: the client can empty the hero from the admin, and every
  // hook below has to keep running regardless, so the empty case is handled
  // after the hooks rather than by an early return here.
  const currentSlide = slides[activeIndex] as ContentSlide | undefined;
  const isPlaybackActive = isHeroVisible && isDocumentVisible;
  const isCurrentVideoFailed = Boolean(currentSlide && failedVideos[currentSlide.id]);
  const isTimedSlide = currentSlide?.media.type === "image" || isCurrentVideoFailed;

  const updateProgress = useCallback((value: number) => {
    const nextValue = Math.min(Math.max(value, 0), 1);
    progressRef.current = nextValue;
    setProgress(nextValue);
  }, []);

  const slideCount = slides.length;

  const nextSlide = useCallback(() => {
    progressRef.current = 0;
    setProgress(0);
    setActiveIndex((index) => (slideCount ? (index + 1) % slideCount : 0));
  }, [slideCount]);

  const previousSlide = useCallback(() => {
    progressRef.current = 0;
    setProgress(0);
    setActiveIndex((index) =>
      slideCount ? (index - 1 + slideCount) % slideCount : 0,
    );
  }, [slideCount]);

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

      if (id === currentSlide?.id) {
        video.currentTime = 0;
      }
    });
  }, [activeIndex, currentSlide?.id]);

  useEffect(() => {
    Object.entries(videoRefs.current).forEach(([id, video]) => {
      if (!video) return;

      const shouldPlay =
        id === currentSlide?.id &&
        currentSlide.media.type === "video" &&
        !failedVideos[id] &&
        isPlaybackActive;

      if (shouldPlay) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
  }, [currentSlide?.id, currentSlide?.media.type, failedVideos, isPlaybackActive]);

  useEffect(() => {
    if (!isTimedSlide || !isPlaybackActive || !currentSlide) return;

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
    currentSlide,
    isPlaybackActive,
    isTimedSlide,
    nextSlide,
    updateProgress,
  ]);

  // After every hook, so the rules of hooks hold when the client empties the
  // section. A hero with no slides is simply absent rather than a blank
  // full-screen block.
  if (!currentSlide) return null;

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
        {slides.map((slide, index) => {
          const isActive = index === activeIndex;
          const mediaFailed = Boolean(failedVideos[slide.id]);
          const objectPosition = slide.objectPosition ?? undefined;

          return (
            <div
              key={slide.id}
              className={`${styles.mediaLayer} ${isActive ? styles.mediaLayerActive : ""}`}
            >
              {slide.media.type === "image" ? (
                <Image
                  src={withBasePath(slide.media.url)}
                  alt=""
                  fill
                  sizes="100vw"
                  loading={index === 1 ? "eager" : "lazy"}
                  className={styles.image}
                  style={{ objectPosition }}
                />
              ) : (
                <>
                  {/* A video may have no poster: the admin makes it optional,
                      and without one there is simply nothing to show until the
                      first frame decodes. */}
                  {slide.media.posterUrl && (
                    <Image
                      src={withBasePath(slide.media.posterUrl)}
                      alt=""
                      fill
                      priority={index === 0}
                      sizes="100vw"
                      className={styles.image}
                      style={{ objectPosition }}
                    />
                  )}
                  {!mediaFailed && (
                    <video
                      ref={(node) => {
                        videoRefs.current[slide.id] = node;
                      }}
                      src={withBasePath(slide.media.url)}
                      muted
                      playsInline
                      autoPlay={isActive}
                      preload="auto"
                      disablePictureInPicture
                      className={`${styles.video} ${
                        readyVideos[slide.id] ? styles.videoReady : ""
                      }`}
                      style={{ objectPosition }}
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
        href={currentSlide.href ?? "/catalog"}
        className={styles.slideLink}
        aria-label={`Открыть раздел «${currentSlide.title}»`}
      >
        <div className={styles.content}>
          {currentSlide.eyebrow && (
            <span className={styles.eyebrow}>{currentSlide.eyebrow}</span>
          )}
          <h1 className={styles.title}>{currentSlide.title}</h1>

          <div className={styles.progress} aria-hidden="true">
            {slides.map((slide, index) => {
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
