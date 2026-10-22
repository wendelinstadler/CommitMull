import { Accessory } from "./accessories";
import { defaultTracker, Tracker } from "./trackers";

/** Rolle = Vorlage: bestimmt Accessoire und die Futterquellen, mit denen ein neuer Agent startet. */
export type Role = "dev" | "finance" | "learning" | "fitness" | "habits" | "custom";

export interface RoleInfo {
  id: Role;
  label: string;
  /** Kurzer Satz fuer die Auswahl. */
  hint: string;
  /** Accessoire der Rolle; bei "custom" waehlt der Benutzer selbst. */
  accessory: Accessory;
  /** Futterquellen, mit denen ein neuer Agent dieser Rolle startet. */
  trackers: () => Tracker[];
}

export const ROLES: RoleInfo[] = [
  {
    id: "dev",
    label: "Informatiker",
    hint: "Wird von GitHub-Commits gefuettert.",
    accessory: "laptop",
    trackers: () => [defaultTracker("github")],
  },
  {
    id: "finance",
    label: "Finanzen",
    hint: "Ausgaben eintragen, Wochenbudget im Blick behalten.",
    accessory: "whiteboard",
    trackers: () => [defaultTracker("entries", "expense", "Ausgabe")],
  },
  {
    id: "learning",
    label: "Lernen",
    hint: "Fokus-Timer fuer Lernzeit.",
    accessory: "book",
    trackers: () => [defaultTracker("focus")],
  },
  {
    id: "fitness",
    label: "Fitness",
    hint: "Trainingseinheiten abhaken.",
    accessory: "dumbbell",
    trackers: () => [defaultTracker("entries", "check", "Training")],
  },
  {
    id: "habits",
    label: "Gewohnheiten",
    hint: "Taegliche Haekchen.",
    accessory: "checklist",
    trackers: () => [defaultTracker("entries", "check", "Haken")],
  },
  {
    id: "custom",
    label: "Eigene",
    hint: "Accessoire und Futterquellen selbst waehlen.",
    accessory: "none",
    trackers: () => [],
  },
];

export const roleInfo = (id: Role): RoleInfo => ROLES.find((r) => r.id === id) ?? ROLES[ROLES.length - 1];
