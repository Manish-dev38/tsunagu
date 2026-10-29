"use client";

import { Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/segmented";

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

const OPTIONS = [
  { value: "system" as const, label: "System" },
  { value: "light" as const, label: "Light" },
  { value: "dark" as const, label: "Dark" },
];

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

  // compact control inside the collapsed rail: system -> light -> dark -> system
  const cycle = () => choose(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);

  return (
    <>
      <Segmented
        label="Theme"
        className="theme-long"
        options={OPTIONS}
        value={mode}
        onChange={choose}
      />
      <IconButton
        className="theme-icon"
        variant="chrome"
        aria-label="Cycle theme"
        title={`Theme: ${mode}, click to switch`}
        onClick={cycle}
      >
        <Sun />
      </IconButton>
    </>
  );
}
