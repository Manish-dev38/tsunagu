"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "tsunagu-theme";
const MODES = ["system", "light", "dark"] as const;
type Mode = (typeof MODES)[number];

function isMode(value: string | null): value is Mode {
  return value === "system" || value === "light" || value === "dark";
}

function apply(mode: Mode) {
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only localStorage read; SSR has no storage, the initial render must match the prerendered "system" state
    setMode(isMode(stored) ? stored : "system");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = localStorage.getItem(STORAGE_KEY);
      apply(isMode(current) ? current : "system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const choose = (next: Mode) => {
    setMode(next);
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  };

  return (
    <div aria-label="Theme" className="flex rounded border border-neutral-300 text-xs" role="radiogroup">
      {MODES.map((option) => (
        <button
          key={option}
          aria-checked={mode === option}
          className={`flex-1 px-1 py-1 capitalize ${
            mode === option
              ? "bg-neutral-900 text-white dark:text-neutral-950"
              : "hover:bg-neutral-100"
          }`}
          onClick={() => choose(option)}
          role="radio"
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}
