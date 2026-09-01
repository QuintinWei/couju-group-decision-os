export type ConstraintErrorState = {
  message: string;
  canEditCommute: boolean;
};

export function constraintErrorState(error: unknown): ConstraintErrorState {
  const status = isRecord(error) && typeof error.status === "number" ? error.status : null;
  const message = isRecord(error) && typeof error.message === "string"
    ? error.message
    : error instanceof Error
      ? error.message
      : "个人边界提交失败，请稍后重试";
  return { message, canEditCommute: status === 409 && /共同可达地点不足/.test(message) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
