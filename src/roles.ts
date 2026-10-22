import { Accessory } from "./accessories";

/** Rolle = Vorlage: bestimmt Accessoire und die Futterquellen, mit denen ein neuer Agent startet. */
export type Role = "dev" | "finance" | "learning" | "fitness" | "habits" | "custom";

export interface RoleInfo {
  id: Role;
  label: string;
  /** Kurzer Satz fuer die Auswahl. */
  hint: string;
  /** Accessoire der Rolle; bei "custom" waehlt der Benutzer selbst. */
  accessory: Accessory;
  /** Neue Agenten dieser Rolle starten mit einem GitHub-Tracker. */
  github: boolean;
}

export const ROLES: RoleInfo[] = [
  { id: "dev", label: "Informatiker", hint: "Wird von GitHub-Commits gefuettert.", accessory: "laptop", github: true },
  { id: "finance", label: "Finanzen", hint: "Ausgaben gegen ein Budget (Eintraege folgen).", accessory: "whiteboard", github: false },
  { id: "learning", label: "Lernen", hint: "Lernzeit und Lerneinheiten.", accessory: "book", github: false },
  { id: "fitness", label: "Fitness", hint: "Trainingseinheiten.", accessory: "dumbbell", github: false },
  { id: "habits", label: "Gewohnheiten", hint: "Taegliche Haekchen.", accessory: "checklist", github: false },
  { id: "custom", label: "Eigene", hint: "Accessoire und Futterquelle selbst waehlen.", accessory: "none", github: false },
];

export const roleInfo = (id: Role): RoleInfo => ROLES.find((r) => r.id === id) ?? ROLES[ROLES.length - 1];
