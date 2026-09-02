type ReadinessMember = {
  originLocation?: { lng: number; lat: number } | null;
  availability?: unknown[] | null;
  locationReady?: boolean;
  availabilitySubmitted?: boolean;
};

export function getRoomReadiness(input: { targetCount: number; members: ReadinessMember[] }) {
  const groupComplete = input.members.length === input.targetCount;
  const locationsComplete = groupComplete && input.members.every((member) => member.locationReady === true || member.originLocation !== null && member.originLocation !== undefined);
  const availabilityComplete = groupComplete && input.members.every((member) => member.availabilitySubmitted === true || member.availability !== null && member.availability !== undefined);
  return { groupComplete, locationsComplete, availabilityComplete, canStartSelection: locationsComplete && availabilityComplete };
}
