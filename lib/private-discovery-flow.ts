import type { Candidate, Choice } from "./couju";

export type RoundClientAction =
  | { action: "request"; requested: true }
  | { action: "private-discovery" }
  | { action: "nominate"; candidateId: string | null };

export function canRequestPrivateDiscovery(cards: Candidate[], choices: Record<string, Choice>) {
  return cards.length === 12 && cards.every((card) => choices[card.id] === "no");
}

export function privateDiscoveryRequestPlan(): readonly ["save-choices", RoundClientAction, RoundClientAction] {
  return ["save-choices", { action: "request", requested: true }, { action: "private-discovery" }];
}

export function togglePrivateNomination(selectedId: string | null, candidateId: string) {
  return selectedId === candidateId ? null : candidateId;
}

export function privateNominationAction(candidateId: string | null): RoundClientAction {
  return { action: "nominate", candidateId };
}

export function privateDiscoveryFailure(message: string) {
  return { stage: "constraints" as const, message, retryable: true };
}
