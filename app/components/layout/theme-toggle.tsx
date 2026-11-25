"use client";

import {
  ContrastIcon,
  MoonIcon,
  SunIcon,
} from "@/app/components/shared/icons";

const STORAGE_KEY = "wax-theme";
type Theme = "night" | "dark" | "light";

/**
 * The active option is marked by CSS, not React state: the stylesheet already
 * knows which theme is on the html element, so the switch is correct on the
 * first frame (no flash, no hydration mismatch) and clicking it is the only
 * thing that changes the palette.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode: the theme still applies for this page view.
  }
}

const options: { id: Theme; label: string; icon: typeof MoonIcon }[] = [
  { id: "night", label: "Night theme", icon: MoonIcon },
  { id: "dark", label: "Dark theme", icon: ContrastIcon },
  { id: "light", label: "Light theme", icon: SunIcon },
];

export default function ThemeToggle() {
  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-xl border border-fg/[0.07] bg-fg/[0.03] p-0.5"
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => applyTheme(option.id)}
            aria-label={option.label}
            title={option.label}
            data-theme-option={option.id}
            className="wax-theme-option wax-press grid h-7 w-8 place-items-center rounded-[9px]"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
