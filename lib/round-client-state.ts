export function reconcileAuthoritativeRound(input: { knownRound: number | null; nextRound: number }) {
  const roundChanged = input.knownRound !== null && input.knownRound !== input.nextRound;
  return {
    roundChanged,
    resetRoundScopedState: roundChanged,
    nextStage: roundChanged ? "room" as const : null,
  };
}

export function getRoundControlVisibility(input: { currentRound: number; creatorId: string | undefined; memberId: string | undefined; allSubmitted: boolean; submitted: boolean }) {
  const isCreator = Boolean(input.creatorId && input.creatorId === input.memberId);
  return {
    isCreator,
    canAdvance: isCreator && input.allSubmitted && input.currentRound < 3,
    canRequestRefresh: !isCreator && input.submitted && input.currentRound < 3,
  };
}
