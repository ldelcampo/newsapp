import type { Theme } from '@shared/settings'

/** Applies the chosen theme to the page; "system" leaves it to the OS setting. */
export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}
