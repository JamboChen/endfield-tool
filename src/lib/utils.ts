import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Calculates the production rate (per minute).
 * @param amount Amount produced per craft
 * @param craftingTime Time to craft in seconds
 */
export const calcRate = (amount: number, craftingTime: number): number =>
  (amount * 60) / craftingTime;
