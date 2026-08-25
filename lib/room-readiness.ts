type ReadinessMember = {
  originLocation: { lng: number; lat: number } | null;
  availability: unknown[] | null;
};

export function getRoomReadiness(input: { targetCount: number; members: ReadinessMember[] }) {
  const groupComplete = input.members.length === input.targetCount;
  const locationsComplete = groupComplete && input.members.every((member) => member.originLocation !== null);
  const availabilityComplete = groupComplete && input.members.every((member) => member.availability !== null);
  return { groupComplete, locationsComplete, availabilityComplete, canStartSelection: locationsComplete && availabilityComplete };
}
