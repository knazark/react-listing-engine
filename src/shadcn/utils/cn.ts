import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class-name fragments, letting `tailwind-merge` resolve conflicting Tailwind utilities (last one wins). Mirrors `react-wizard-engine`'s `~/utils/cn`. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
